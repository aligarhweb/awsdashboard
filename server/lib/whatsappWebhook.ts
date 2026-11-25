import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { normalizeWhatsappNumber } from './messaging';
import { logError } from './logger';

export function verifyMetaWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!appSecret || !signatureHeader) return false;
  const trimmed = signatureHeader.trim();
  if (!trimmed.startsWith('sha256=')) return false;
  const providedHex = trimmed.slice(7).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(providedHex)) return false;

  const expectedHex = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex')
    .toLowerCase();

  const a = Buffer.from(providedHex, 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifyMetaHubChallenge(
  mode: string | undefined,
  token: string | undefined,
  challenge: string | undefined,
  expectedVerifyToken: string
): string | null {
  if (mode !== 'subscribe' || !expectedVerifyToken || !token || !challenge) {
    return null;
  }
  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(expectedVerifyToken, 'utf8');
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return challenge;
}

export function extractWhatsAppInboundBody(msg: any): string {
  if (!msg || typeof msg !== 'object') return '[Empty message]';
  const type = String(msg.type || 'unknown');

  if (type === 'text' && msg.text?.body) {
    return String(msg.text.body);
  }
  if (type === 'button' && (msg.button?.text || msg.button?.payload)) {
    return String(msg.button.text || msg.button.payload);
  }
  if (type === 'interactive') {
    const btnTitle = msg.interactive?.button_reply?.title;
    const listTitle = msg.interactive?.list_reply?.title;
    const listDesc = msg.interactive?.list_reply?.description;
    if (btnTitle) return String(btnTitle);
    if (listTitle) return listDesc ? `${listTitle} — ${listDesc}` : String(listTitle);
  }
  if (type === 'reaction' && msg.reaction?.emoji) {
    return `Reacted ${msg.reaction.emoji}`;
  }

  const mediaObj = msg[type];
  if (mediaObj && typeof mediaObj === 'object') {
    const caption = mediaObj.caption ? `: ${mediaObj.caption}` : '';
    const filename = mediaObj.filename ? ` (${mediaObj.filename})` : '';
    return `[${type.toUpperCase()}${filename}]${caption}`;
  }

  if (type === 'location' && msg.location) {
    return `[LOCATION] ${msg.location.name || ''} (${msg.location.latitude}, ${msg.location.longitude})`.trim();
  }

  return `[${type.toUpperCase()} message]`;
}

function phoneMatches(candidate: string | null | undefined, incomingNormalized: string): boolean {
  const norm = normalizeWhatsappNumber(candidate);
  if (!norm) return false;
  if (norm === incomingNormalized) return true;
  if (norm.length >= 10 && incomingNormalized.length >= 10) {
    return norm.slice(-10) === incomingNormalized.slice(-10);
  }
  return false;
}

export async function findClientByWhatsappPhone(
  prisma: PrismaClient,
  fromPhone: string
): Promise<any | null> {
  const normalized = normalizeWhatsappNumber(fromPhone);
  if (!normalized) return null;

  const clients = await prisma.client.findMany({
    where: { status: { not: 'ARCHIVED' } },
  });

  for (const c of clients as any[]) {
    if (phoneMatches(c.whatsappPhone, normalized)) return c;
    if (Array.isArray(c.secondaryPhones)) {
      for (const sec of c.secondaryPhones) {
        if (phoneMatches(String(sec || ''), normalized)) return c;
      }
    }
  }
  return null;
}

const STATUS_RANK: Record<string, number> = {
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 1,
};

function parseMetaTimestamp(ts: any, fallback: Date): Date {
  const sec = Number(ts);
  if (Number.isFinite(sec) && sec > 1_000_000_000) {
    return new Date(sec * 1000);
  }
  return fallback;
}

export async function processWhatsAppWebhookPayload(
  prisma: PrismaClient,
  payload: any,
  now: Date = new Date()
): Promise<{ statusesUpdated: number; inboundCreated: number; duplicatesSkipped: number }> {
  let statusesUpdated = 0;
  let inboundCreated = 0;
  let duplicatesSkipped = 0;

  if (!payload || !Array.isArray(payload.entry)) {
    return { statusesUpdated, inboundCreated, duplicatesSkipped };
  }

  for (const entry of payload.entry) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      if (!value || typeof value !== 'object') continue;

      // 1. Outbound delivery & read receipts
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      for (const st of statuses) {
        const wamid = st?.id ? String(st.id) : '';
        const rawStatus = String(st?.status || '').toLowerCase();
        if (!wamid || !rawStatus) continue;

        const existing = await prisma.messageLog.findFirst({
          where: { providerMessageId: wamid },
        });
        if (!existing) continue;

        let mappedStatus: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | null = null;
        if (rawStatus === 'sent') mappedStatus = 'SENT';
        else if (rawStatus === 'delivered') mappedStatus = 'DELIVERED';
        else if (rawStatus === 'read') mappedStatus = 'READ';
        else if (rawStatus === 'failed') mappedStatus = 'FAILED';
        if (!mappedStatus) continue;

        // Avoid regressing READ -> DELIVERED -> SENT
        const curRank = STATUS_RANK[existing.status] ?? 0;
        const nextRank = STATUS_RANK[mappedStatus] ?? 0;
        if (mappedStatus !== 'FAILED' && nextRank < curRank) {
          continue;
        }
        if (mappedStatus === 'FAILED' && ['DELIVERED', 'READ'].includes(existing.status)) {
          continue;
        }

        const eventTime = parseMetaTimestamp(st.timestamp, now);
        const errorText =
          mappedStatus === 'FAILED'
            ? String(
                st?.errors?.[0]?.error_data?.details ||
                  st?.errors?.[0]?.message ||
                  st?.errors?.[0]?.title ||
                  'Meta Cloud API delivery failure'
              ).slice(0, 1000)
            : null;

        await prisma.messageLog.update({
          where: { id: existing.id },
          data: {
            status: mappedStatus,
            ...(mappedStatus !== 'FAILED' && !existing.sentAt ? { sentAt: eventTime } : {}),
            ...(mappedStatus === 'FAILED' ? { error: errorText } : { error: null }),
          },
        });
        statusesUpdated += 1;
      }

      // 2. Incoming WhatsApp messages / client replies
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const msg of messages) {
        const wamid = msg?.id ? String(msg.id) : '';
        const fromRaw = msg?.from ? String(msg.from) : '';
        if (!wamid || !fromRaw) continue;

        const idempotencyKey = `WA_IN:${wamid}`;
        const dup = await prisma.messageLog.findUnique({ where: { idempotencyKey } });
        if (dup) {
          duplicatesSkipped += 1;
          continue;
        }

        const matchedClient = await findClientByWhatsappPhone(prisma, fromRaw);
        const contactProfile = contacts.find((c: any) => String(c?.wa_id || '') === fromRaw);
        const profileName = contactProfile?.profile?.name
          ? String(contactProfile.profile.name)
          : null;
        const bodyText = extractWhatsAppInboundBody(msg);
        const msgTime = parseMetaTimestamp(msg.timestamp, now);
        const senderLabel = matchedClient?.name || profileName || `+${normalizeWhatsappNumber(fromRaw) || fromRaw}`;

        const created = await prisma.messageLog.create({
          data: {
            clientId: matchedClient?.id || null,
            channel: 'WHATSAPP',
            renderedSubject: `WhatsApp reply from ${senderLabel}`,
            renderedContent: bodyText,
            entityType: matchedClient ? 'INBOUND_REPLY' : 'UNMATCHED_INBOUND',
            entityId: matchedClient?.id || fromRaw,
            idempotencyKey,
            sentAt: msgTime,
            status: 'DELIVERED',
            providerMessageId: wamid,
            direction: 'INBOUND',
          },
        });

        try {
          if (typeof (prisma.auditLog as any)?.create === 'function') {
            await prisma.auditLog.create({
              data: {
                action: 'WHATSAPP_INBOUND_RECEIVED',
                entityType: matchedClient ? 'Client' : 'MessageLog',
                entityId: matchedClient?.id || created.id,
                summary: `Inbound WhatsApp from ${senderLabel}: ${bodyText.slice(0, 120)}`,
              },
            });
          }
        } catch (err) {
          logError('Failed to write webhook audit log', err);
        }

        inboundCreated += 1;
      }
    }
  }

  return { statusesUpdated, inboundCreated, duplicatesSkipped };
}
