import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { requireAuth, getClientIp } from '../middleware/auth';
import { decryptSecret, encryptSecret, maskSecret } from '../lib/crypto';
import { recordAudit } from '../lib/audit';

const router = Router();
router.use(requireAuth);

const providerSchema = z.object({
  name: z.string().trim().min(1).max(191),
  providerKey: z.enum(['HOSTINGER', 'GODADDY', 'REDIFF', 'SPACESHIP', 'CLOUDFLARE', 'OTHER']).default('OTHER'),
  type: z.enum(['REGISTRAR', 'HOST', 'BOTH']).default('BOTH'),
  loginEmail: z.string().trim().email().optional().nullable().or(z.literal('')),
  accountUrl: z.string().trim().url().optional().nullable().or(z.literal('')),
  notes: z.string().trim().max(3000).optional().nullable(),
  apiCredentials: z.string().trim().max(4000).optional().nullable(),
  apiSyncEnabled: z.boolean().default(false),
});

function serializeProvider(p: any) {
  let mask: string | null = null;
  if (p.apiCredentialsEncrypted) {
    try {
      mask = maskSecret(decryptSecret(p.apiCredentialsEncrypted));
    } catch {
      mask = '••••';
    }
  }
  return {
    id: p.id,
    name: p.name,
    providerKey: p.providerKey,
    type: p.type,
    loginEmail: p.loginEmail,
    accountUrl: p.accountUrl,
    notes: p.notes,
    hasApiCredentials: Boolean(p.apiCredentialsEncrypted),
    apiCredentialsMask: mask,
    apiSyncEnabled: Boolean(p.apiSyncEnabled),
    isDemo: Boolean(p.isDemo),
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
    _count: p._count,
  };
}

router.get('/', async (_req, res, next) => {
  try {
    const providers = await db.providerAccount.findMany({
      include: { _count: { select: { domains: true, services: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ items: providers.map(serializeProvider) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = providerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid provider account details', issues: parsed.error.flatten() });
      return;
    }
    const d = parsed.data;
    const encrypted = d.apiCredentials ? encryptSecret(d.apiCredentials) : null;

    const created = await db.providerAccount.create({
      data: {
        name: d.name,
        providerKey: d.providerKey,
        type: d.type,
        loginEmail: d.loginEmail || null,
        accountUrl: d.accountUrl || null,
        notes: d.notes || null,
        apiCredentialsEncrypted: encrypted,
        apiSyncEnabled: d.providerKey === 'REDIFF' ? false : d.apiSyncEnabled,
      },
      include: { _count: { select: { domains: true, services: true } } },
    });

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'PROVIDER_CREATED',
      entityType: 'ProviderAccount',
      entityId: created.id,
      summary: `Created provider account ${created.name}`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ provider: serializeProvider(created) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const existing = await db.providerAccount.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Provider account not found' });
      return;
    }

    const parsed = providerSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid provider update', issues: parsed.error.flatten() });
      return;
    }

    const d = parsed.data;
    const updateData: any = {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.providerKey !== undefined ? { providerKey: d.providerKey } : {}),
      ...(d.type !== undefined ? { type: d.type } : {}),
      ...(d.loginEmail !== undefined ? { loginEmail: d.loginEmail || null } : {}),
      ...(d.accountUrl !== undefined ? { accountUrl: d.accountUrl || null } : {}),
      ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
      ...(d.apiSyncEnabled !== undefined ? { apiSyncEnabled: d.apiSyncEnabled } : {}),
    };

    if (d.apiCredentials !== undefined) {
      updateData.apiCredentialsEncrypted = d.apiCredentials ? encryptSecret(d.apiCredentials) : null;
    }

    const updated = await db.providerAccount.update({
      where: { id: req.params.id },
      data: updateData,
      include: { _count: { select: { domains: true, services: true } } },
    });

    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'PROVIDER_UPDATED',
      entityType: 'ProviderAccount',
      entityId: updated.id,
      summary: `Updated provider account ${updated.name}`,
      ipAddress: getClientIp(req),
    });

    res.json({ provider: serializeProvider(updated) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await db.providerAccount.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Provider account not found' });
      return;
    }
    await db.providerAccount.delete({ where: { id: req.params.id } });
    await recordAudit({
      actorEmail: req.authUser?.email,
      action: 'PROVIDER_DELETED',
      entityType: 'ProviderAccount',
      entityId: existing.id,
      summary: `Deleted provider account ${existing.name}`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
