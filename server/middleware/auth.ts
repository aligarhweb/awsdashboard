import { NextFunction, Request, Response } from 'express';
import { db } from '../db';
import { hashToken } from '../lib/crypto';
import { AuthUserDTO } from '../../shared/types';

export const SESSION_COOKIE_NAME = 'aws_cc_session';

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUserDTO;
      sessionId?: string;
    }
  }
}

export function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function extractSessionToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }
  return null;
}

export function setSessionCookie(req: Request, res: Response, rawToken: string, expiresAt: Date): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    ...(isHttps ? { partitioned: true } : {}),
    expires: expiresAt,
    path: '/',
  });
}

export function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    ...(isHttps ? { partitioned: true } : {}),
    path: '/',
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawToken = extractSessionToken(req);
    if (!rawToken) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const tokenHash = hashToken(rawToken);
    const session = await db.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session || session.expiresAt.getTime() < Date.now() || !session.user) {
      if (session) {
        await db.session.delete({ where: { id: session.id } }).catch(() => {});
      }
      res.status(401).json({ error: 'Session expired or invalid' });
      return;
    }

    req.sessionId = session.id;
    req.authUser = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      totpEnabled: Boolean(session.user.totpEnabled),
      lastLoginAt: session.user.lastLoginAt ? session.user.lastLoginAt.toISOString() : null,
    };

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * CSRF safeguard for cookie-authenticated mutations.
 * Verifies same-origin Origin/Referer or explicit X-Requested-With custom header.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  // Exempt cron and signed webhook endpoints
  if (
    req.path === '/api/cron/tick' ||
    req.path === '/cron/tick' ||
    req.path.startsWith('/api/webhooks/') ||
    req.path.startsWith('/webhooks/')
  ) {
    next();
    return;
  }

  // If caller uses Bearer token instead of cookie, CSRF does not apply
  if (req.headers.authorization?.startsWith('Bearer ')) {
    next();
    return;
  }

  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '') as string;

  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (host && originHost === host) {
        next();
        return;
      }
      const appUrl = process.env.APP_URL?.trim();
      if (appUrl && new URL(appUrl).host === originHost) {
        next();
        return;
      }
    } catch {
      // fall through to reject
    }
    res.status(403).json({ error: 'Cross-site request blocked (Origin mismatch)' });
    return;
  }

  if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
    next();
    return;
  }

  // Allow non-browser API clients without cookies
  if (!req.cookies?.[SESSION_COOKIE_NAME]) {
    next();
    return;
  }

  res.status(403).json({ error: 'CSRF check failed' });
}
