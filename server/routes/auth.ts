import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';
import { db } from '../db';
import {
  decryptSecret,
  encryptSecret,
  generateRandomToken,
  hashToken,
} from '../lib/crypto';
import {
  clearSessionCookie,
  getClientIp,
  requireAuth,
  setSessionCookie,
} from '../middleware/auth';
import { recordAudit } from '../lib/audit';
import { ensureDefaultRulesAndTemplates, ensureDefaultSettings, seedDemoData } from '../lib/demoSeed';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' },
});

const setupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(191),
  password: z.string().min(8).max(128),
  seedDemo: z.boolean().optional().default(true),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  totpCode: z.string().trim().optional(),
});

async function createUserSession(userId: string, req: any, res: any) {
  const rawToken = generateRandomToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.session.create({
    data: {
      userId,
      tokenHash,
      ipAddress: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 500) || null,
      expiresAt,
    },
  });

  setSessionCookie(req, res, rawToken, expiresAt);
  return rawToken;
}

router.get('/status', async (req, res, next) => {
  try {
    const userCount = await db.user.count();
    const needsSetup = userCount === 0;

    // Also check if currently authenticated without throwing 401
    let user = null;
    if (!needsSetup) {
      const token =
        req.headers.authorization?.startsWith('Bearer ')
          ? req.headers.authorization.slice(7).trim()
          : req.cookies?.aws_cc_session;

      if (token) {
        const session = await db.session.findUnique({
          where: { tokenHash: hashToken(token) },
          include: { user: true },
        });
        if (session && session.expiresAt.getTime() > Date.now() && session.user) {
          user = {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name,
            totpEnabled: Boolean(session.user.totpEnabled),
            lastLoginAt: session.user.lastLoginAt ? session.user.lastLoginAt.toISOString() : null,
          };
        }
      }
    }

    res.json({
      needsSetup,
      authenticated: Boolean(user),
      user,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/setup', authLimiter, async (req, res, next) => {
  try {
    const existingUsers = await db.user.count();
    if (existingUsers > 0) {
      res.status(403).json({ error: 'Setup is already complete. Please sign in.' });
      return;
    }

    const parsed = setupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid setup details', issues: parsed.error.flatten() });
      return;
    }

    const email = parsed.data.email.toLowerCase();
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);

    const user = await db.user.create({
      data: {
        email,
        name: parsed.data.name,
        passwordHash,
        lastLoginAt: new Date(),
      },
    });

    await ensureDefaultSettings(db);
    await ensureDefaultRulesAndTemplates(db);
    if (parsed.data.seedDemo) {
      await seedDemoData(db);
    }

    const token = await createUserSession(user.id, req, res);
    await recordAudit({
      actorEmail: user.email,
      action: 'AUTH_SETUP',
      entityType: 'User',
      entityId: user.id,
      summary: `Initial owner account created (${user.email})`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        totpEnabled: false,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid email and password are required' });
      return;
    }

    const email = parsed.data.email.toLowerCase();
    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const validPassword = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!validPassword) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    if (user.totpEnabled && user.totpSecretEncrypted) {
      const code = (parsed.data.totpCode || '').replace(/\s+/g, '');
      if (!code) {
        res.status(200).json({ requiresTotp: true });
        return;
      }
      const secretBase32 = decryptSecret(user.totpSecretEncrypted);
      const totp = new OTPAuth.TOTP({
        issuer: 'AWS Control Center',
        label: user.email,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(secretBase32),
      });
      const delta = totp.validate({ token: code, window: 1 });
      if (delta === null) {
        res.status(401).json({ error: 'Invalid 2FA verification code', requiresTotp: true });
        return;
      }
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = await createUserSession(user.id, req, res);
    await recordAudit({
      actorEmail: user.email,
      action: 'AUTH_LOGIN',
      entityType: 'User',
      entityId: user.id,
      summary: `Owner signed in from ${getClientIp(req)}`,
      ipAddress: getClientIp(req),
    });

    res.json({
      token,
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        totpEnabled: Boolean(updated.totpEnabled),
        lastLoginAt: updated.lastLoginAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const cookieToken = req.cookies?.aws_cc_session;
    const bearerToken = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : null;
    if (cookieToken) {
      await db.session.deleteMany({ where: { tokenHash: hashToken(cookieToken) } }).catch(() => {});
    }
    if (bearerToken) {
      await db.session.deleteMany({ where: { tokenHash: hashToken(bearerToken) } }).catch(() => {});
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.authUser });
});

router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8).max(128),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'New password must be at least 8 characters' });
      return;
    }

    const user = await db.user.findUnique({ where: { id: req.authUser!.id } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const ok = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    const newHash = await bcrypt.hash(parsed.data.newPassword, 12);
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    // Revoke other sessions
    await db.session.deleteMany({
      where: {
        userId: user.id,
        ...(req.sessionId ? { id: { not: req.sessionId } } : {}),
      },
    });

    await recordAudit({
      actorEmail: user.email,
      action: 'AUTH_PASSWORD_CHANGED',
      entityType: 'User',
      entityId: user.id,
      summary: 'Owner password changed',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/2fa/setup', requireAuth, async (req, res, next) => {
  try {
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: 'AWS Control Center',
      label: req.authUser!.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });
    const uri = totp.toString();
    const qrDataUrl = await QRCode.toDataURL(uri, { width: 220, margin: 1 });
    res.json({ secret: secret.base32, otpauthUri: uri, qrDataUrl });
  } catch (err) {
    next(err);
  }
});

router.post('/2fa/enable', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      secret: z.string().min(16),
      code: z.string().trim().min(6).max(8),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid secret and 6-digit code are required' });
      return;
    }

    const totp = new OTPAuth.TOTP({
      issuer: 'AWS Control Center',
      label: req.authUser!.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(parsed.data.secret),
    });
    const delta = totp.validate({ token: parsed.data.code.replace(/\s+/g, ''), window: 1 });
    if (delta === null) {
      res.status(400).json({ error: 'Invalid verification code. Please check your authenticator clock.' });
      return;
    }

    await db.user.update({
      where: { id: req.authUser!.id },
      data: {
        totpSecretEncrypted: encryptSecret(parsed.data.secret),
        totpEnabled: true,
      },
    });

    await recordAudit({
      actorEmail: req.authUser!.email,
      action: 'AUTH_2FA_ENABLED',
      entityType: 'User',
      entityId: req.authUser!.id,
      summary: 'TOTP two-factor authentication enabled',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true, totpEnabled: true });
  } catch (err) {
    next(err);
  }
});

router.post('/2fa/disable', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({ password: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Password is required to disable 2FA' });
      return;
    }

    const user = await db.user.findUnique({ where: { id: req.authUser!.id } });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      res.status(401).json({ error: 'Incorrect password' });
      return;
    }

    await db.user.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpSecretEncrypted: null },
    });

    await recordAudit({
      actorEmail: user.email,
      action: 'AUTH_2FA_DISABLED',
      entityType: 'User',
      entityId: user.id,
      summary: 'TOTP two-factor authentication disabled',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true, totpEnabled: false });
  } catch (err) {
    next(err);
  }
});

router.post('/forgot-password', authLimiter, async (req, res, next) => {
  try {
    const schema = z.object({ email: z.string().trim().email() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid email is required' });
      return;
    }

    const user = await db.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (!user) {
      // Do not reveal account existence
      res.json({ ok: true, message: 'If that email exists and SMTP is configured, a reset link has been sent.' });
      return;
    }

    const settings = await db.settings.findUnique({ where: { id: 1 } });
    if (!settings?.smtpUser || !settings?.smtpPassEncrypted) {
      res.status(400).json({
        error: 'SMTP is not configured yet. Please reset your password via CLI/database or configure SMTP in Settings.',
      });
      return;
    }

    const rawResetToken = generateRandomToken(32);
    const resetTokenHash = hashToken(rawResetToken);
    const resetTokenExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await db.user.update({
      where: { id: user.id },
      data: { resetTokenHash, resetTokenExpiresAt },
    });

    const baseUrl =
      process.env.APP_URL?.trim() ||
      `${req.protocol}://${req.headers['x-forwarded-host'] || req.headers.host}`;
    const resetLink = `${baseUrl}/?resetToken=${rawResetToken}`;

    const transporter = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.smtpSecure,
      auth: {
        user: settings.smtpUser,
        pass: decryptSecret(settings.smtpPassEncrypted),
      },
    });

    await transporter.sendMail({
      from: `"${settings.smtpFromName}" <${settings.smtpFromEmail || settings.smtpUser}>`,
      to: user.email,
      subject: 'Password Reset — AWS Control Center',
      text: `You requested a password reset for AWS Control Center.\n\nOpen this link within 30 minutes to set a new password:\n${resetLink}\n\nIf you did not request this, ignore this email.`,
    });

    await recordAudit({
      actorEmail: user.email,
      action: 'AUTH_PASSWORD_RESET_REQUESTED',
      entityType: 'User',
      entityId: user.id,
      summary: 'Password reset email dispatched',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true, message: 'If that email exists and SMTP is configured, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', authLimiter, async (req, res, next) => {
  try {
    const schema = z.object({
      token: z.string().min(16),
      newPassword: z.string().min(8).max(128),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid reset token and new password (min 8 chars) are required' });
      return;
    }

    const tokenHash = hashToken(parsed.data.token);
    const user = await db.user.findFirst({
      where: {
        resetTokenHash: tokenHash,
        resetTokenExpiresAt: { gt: new Date() },
      },
    });

    if (!user) {
      res.status(400).json({ error: 'Reset link is invalid or expired' });
      return;
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash, resetTokenHash: null, resetTokenExpiresAt: null },
    });
    await db.session.deleteMany({ where: { userId: user.id } });

    await recordAudit({
      actorEmail: user.email,
      action: 'AUTH_PASSWORD_RESET_COMPLETED',
      entityType: 'User',
      entityId: user.id,
      summary: 'Owner password reset via email token',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
