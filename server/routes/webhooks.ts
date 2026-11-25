import { Router } from 'express';
import { db } from '../db';
import { decryptSecret } from '../lib/crypto';
import {
  processWhatsAppWebhookPayload,
  verifyMetaHubChallenge,
  verifyMetaWebhookSignature,
} from '../lib/whatsappWebhook';
import { logWarn } from '../lib/logger';

const router = Router();

/**
 * Meta WhatsApp Cloud API Webhook Verification (GET)
 * Called once when configuring the callback URL in Meta App Dashboard.
 */
router.get('/whatsapp', async (req, res, next) => {
  try {
    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const expectedToken =
      (settings?.whatsappVerifyTokenEnc ? decryptSecret(settings.whatsappVerifyTokenEnc) : '') ||
      process.env.WHATSAPP_VERIFY_TOKEN?.trim() ||
      '';

    if (!expectedToken) {
      res.status(503).send('WhatsApp Verify Token is not configured');
      return;
    }

    const mode = typeof req.query['hub.mode'] === 'string' ? req.query['hub.mode'] : undefined;
    const token = typeof req.query['hub.verify_token'] === 'string' ? req.query['hub.verify_token'] : undefined;
    const challenge = typeof req.query['hub.challenge'] === 'string' ? req.query['hub.challenge'] : undefined;

    const accepted = verifyMetaHubChallenge(mode, token, challenge, expectedToken);
    if (!accepted) {
      res.status(403).send('Forbidden');
      return;
    }

    res.status(200).type('text/plain').send(accepted);
  } catch (err) {
    next(err);
  }
});

/**
 * Meta WhatsApp Cloud API Webhook Event Receiver (POST)
 * Protected strictly via X-Hub-Signature-256 HMAC-SHA256 verification against raw request bytes.
 */
router.post('/whatsapp', async (req, res, next) => {
  try {
    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const appSecret =
      (settings?.whatsappAppSecretEnc ? decryptSecret(settings.whatsappAppSecretEnc) : '') ||
      process.env.WHATSAPP_APP_SECRET?.trim() ||
      '';

    if (!appSecret) {
      res.status(503).json({ error: 'WhatsApp App Secret is not configured' });
      return;
    }

    const rawBody: Buffer | string =
      (req as any).rawBody instanceof Buffer
        ? (req as any).rawBody
        : Buffer.from(JSON.stringify(req.body || {}), 'utf8');
    const sigHeader =
      typeof req.headers['x-hub-signature-256'] === 'string'
        ? req.headers['x-hub-signature-256']
        : undefined;

    if (!verifyMetaWebhookSignature(rawBody, sigHeader, appSecret)) {
      logWarn('Rejected WhatsApp webhook with invalid X-Hub-Signature-256');
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    const result = await processWhatsAppWebhookPayload(db, req.body);
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

export default router;
