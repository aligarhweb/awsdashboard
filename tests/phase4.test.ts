import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  extractWhatsAppInboundBody,
  processWhatsAppWebhookPayload,
  verifyMetaHubChallenge,
  verifyMetaWebhookSignature,
} from '../server/lib/whatsappWebhook';

function createWebhookMockDb(initial?: { clients?: any[]; logs?: any[] }) {
  let seq = 1;
  const state = {
    client: (initial?.clients || []).map((c) => ({ ...c })),
    messageLog: (initial?.logs || []).map((l) => ({ ...l })),
    auditLog: [] as any[],
  };

  return {
    _state: state,
    client: {
      findMany: async ({ where }: any = {}) =>
        state.client.filter((c) => {
          if (where?.status?.not && c.status === where.status.not) return false;
          return true;
        }),
    },
    messageLog: {
      findFirst: async ({ where }: any) =>
        state.messageLog.find((l) => l.providerMessageId === where?.providerMessageId) || null,
      findUnique: async ({ where }: any) =>
        state.messageLog.find((l) => l.idempotencyKey === where?.idempotencyKey) || null,
      create: async ({ data }: any) => {
        const row = { id: `log_${seq++}`, createdAt: new Date(), ...data };
        state.messageLog.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const idx = state.messageLog.findIndex((l) => l.id === where.id);
        if (idx === -1) throw new Error('Not found');
        state.messageLog[idx] = { ...state.messageLog[idx], ...data };
        return state.messageLog[idx];
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const row = { id: `aud_${seq++}`, createdAt: new Date(), ...data };
        state.auditLog.push(row);
        return row;
      },
    },
  } as any;
}

describe('Phase 4 Meta WhatsApp Cloud API Webhook Security & Event Processing', () => {
  it('verifies Meta Hub GET challenge with timing-safe token comparison', () => {
    expect(verifyMetaHubChallenge('subscribe', 'secret_verify_123', '998877', 'secret_verify_123')).toBe(
      '998877'
    );
    expect(verifyMetaHubChallenge('subscribe', 'wrong_token', '998877', 'secret_verify_123')).toBeNull();
    expect(verifyMetaHubChallenge('unsubscribe', 'secret_verify_123', '998877', 'secret_verify_123')).toBeNull();
    expect(verifyMetaHubChallenge('subscribe', 'secret_verify_123', undefined, 'secret_verify_123')).toBeNull();
  });

  it('verifies X-Hub-Signature-256 HMAC-SHA256 strictly against raw request bytes', () => {
    const secret = 'meta_app_secret_xyz';
    const rawBody = Buffer.from('{"object":"whatsapp_business_account","entry":[]}', 'utf8');
    const validSig =
      'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    expect(verifyMetaWebhookSignature(rawBody, validSig, secret)).toBe(true);
    expect(verifyMetaWebhookSignature(rawBody, 'sha256=' + '0'.repeat(64), secret)).toBe(false);
    expect(verifyMetaWebhookSignature(rawBody, 'invalid-prefix', secret)).toBe(false);
    expect(verifyMetaWebhookSignature(Buffer.from('tampered', 'utf8'), validSig, secret)).toBe(false);
  });

  it('extracts text, button, interactive, and media inbound message formats cleanly', () => {
    expect(extractWhatsAppInboundBody({ type: 'text', text: { body: 'Paid via UPI' } })).toBe(
      'Paid via UPI'
    );
    expect(
      extractWhatsAppInboundBody({
        type: 'interactive',
        interactive: { button_reply: { title: 'Confirm Renewal' } },
      })
    ).toBe('Confirm Renewal');
    expect(
      extractWhatsAppInboundBody({
        type: 'document',
        document: { filename: 'receipt.pdf', caption: 'UTR attached' },
      })
    ).toBe('[DOCUMENT (receipt.pdf)]: UTR attached');
  });

  it('updates delivery/read receipts monotonically and stores idempotent inbound replies matched to clients', async () => {
    const db = createWebhookMockDb({
      clients: [
        {
          id: 'c_brass',
          name: 'Aligarh Brass Exports',
          whatsappPhone: '+91 98370 11223',
          secondaryPhones: ['09837099887'],
          status: 'ACTIVE',
        },
      ],
      logs: [
        {
          id: 'out_1',
          clientId: 'c_brass',
          channel: 'WHATSAPP',
          status: 'SENT',
          providerMessageId: 'wamid.OUT1',
          direction: 'OUTBOUND',
          sentAt: new Date('2026-11-24T10:00:00Z'),
        },
      ],
    });

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [
                  { id: 'wamid.OUT1', status: 'delivered', timestamp: '1795515000' },
                  { id: 'wamid.OUT1', status: 'read', timestamp: '1795515060' },
                  // Regression attempt (delivered after read) must be ignored
                  { id: 'wamid.OUT1', status: 'delivered', timestamp: '1795515090' },
                ],
                contacts: [{ wa_id: '919837011223', profile: { name: 'Tariq Ahmad' } }],
                messages: [
                  {
                    id: 'wamid.IN1',
                    from: '919837011223',
                    timestamp: '1795515100',
                    type: 'text',
                    text: { body: 'Please renew aligarhbrass.in for 1 year.' },
                  },
                  {
                    id: 'wamid.IN2',
                    from: '919999988888',
                    timestamp: '1795515120',
                    type: 'text',
                    text: { body: 'Unknown sender inquiry' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const res1 = await processWhatsAppWebhookPayload(db, payload);
    expect(res1.statusesUpdated).toBe(2); // delivered then read; regression skipped
    expect(res1.inboundCreated).toBe(2);
    expect(res1.duplicatesSkipped).toBe(0);

    expect(db._state.messageLog[0].status).toBe('READ');

    const inboundMatched = db._state.messageLog.find((l: any) => l.providerMessageId === 'wamid.IN1');
    expect(inboundMatched.clientId).toBe('c_brass');
    expect(inboundMatched.direction).toBe('INBOUND');
    expect(inboundMatched.status).toBe('DELIVERED');
    expect(inboundMatched.entityType).toBe('INBOUND_REPLY');
    expect(inboundMatched.renderedContent).toContain('aligarhbrass.in');

    const inboundUnknown = db._state.messageLog.find((l: any) => l.providerMessageId === 'wamid.IN2');
    expect(inboundUnknown.clientId).toBeNull();
    expect(inboundUnknown.entityType).toBe('UNMATCHED_INBOUND');

    // Replaying exact webhook payload must be idempotent for inbound replies
    const res2 = await processWhatsAppWebhookPayload(db, payload);
    expect(res2.inboundCreated).toBe(0);
    expect(res2.duplicatesSkipped).toBe(2);
    expect(db._state.messageLog.length).toBe(3);
  });
});
