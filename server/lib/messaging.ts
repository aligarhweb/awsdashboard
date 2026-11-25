import nodemailer from 'nodemailer';
import { decryptSecret } from './crypto';
import { getIstDateParts } from '../../shared/dates';

export type TemplateVariables = Record<string, string | number | null | undefined>;

export function renderTemplateText(template: string, vars: TemplateVariables): string {
  if (!template) return '';
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
    const val = vars[key];
    return val === undefined || val === null ? '' : String(val);
  });
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function plainTextToSafeEmailHtml(text: string, businessName: string): string {
  const escaped = escapeHtml(text).replace(/\n/g, '<br/>');
  const safeBiz = escapeHtml(businessName || 'Aligarh Web Solutions');
  return `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;padding:24px;">
    <div style="font-size:13px;font-weight:700;color:#0284c7;margin-bottom:16px;">${safeBiz}</div>
    <div style="font-size:14px;line-height:1.65;color:#1e293b;">${escaped}</div>
  </div>
</body>
</html>`;
}

function parseHhMm(hhmm?: string | null, fallbackMinutes = 0): number {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return fallbackMinutes;
  const [h, m] = hhmm.split(':').map(Number);
  return (h % 24) * 60 + (m % 60);
}

/**
 * Returns true if current time in IST is OUTSIDE quiet hours (i.e. sending is permitted).
 * Example: quietHoursStart='20:00', quietHoursEnd='09:00' => allowed between 09:00 and 19:59 IST.
 */
export function isWithinSendWindowIST(
  now: Date,
  quietHoursStart = '20:00',
  quietHoursEnd = '09:00',
  timeZone = 'Asia/Kolkata'
): boolean {
  const startMin = parseHhMm(quietHoursStart, 20 * 60);
  const endMin = parseHhMm(quietHoursEnd, 9 * 60);
  if (startMin === endMin) return true; // disabled

  const parts = getIstDateParts(now, timeZone);
  const curMin = parts.hour * 60 + parts.minute;

  // Overnight quiet window (e.g., 20:00 to 09:00)
  if (startMin > endMin) {
    const inQuiet = curMin >= startMin || curMin < endMin;
    return !inQuiet;
  }

  // Same-day quiet window (e.g., 13:00 to 15:00)
  const inQuiet = curMin >= startMin && curMin < endMin;
  return !inQuiet;
}

/**
 * Returns the next Date when quiet hours end (e.g. next 09:00 IST).
 */
export function nextAllowedSendTimeIST(
  now: Date,
  quietHoursStart = '20:00',
  quietHoursEnd = '09:00',
  timeZone = 'Asia/Kolkata'
): Date {
  if (isWithinSendWindowIST(now, quietHoursStart, quietHoursEnd, timeZone)) {
    return now;
  }
  const endMin = parseHhMm(quietHoursEnd, 9 * 60);
  const endHour = Math.floor(endMin / 60);
  const endMinute = endMin % 60;
  const parts = getIstDateParts(now, timeZone);
  const curMin = parts.hour * 60 + parts.minute;

  // IST is UTC+05:30 fixed (330 minutes)
  const istOffsetMs = 330 * 60 * 1000;
  let targetUtcMs =
    Date.UTC(parts.year, parts.month - 1, parts.day, endHour, endMinute, 0) - istOffsetMs;

  if (curMin >= endMin) {
    targetUtcMs += 86_400_000;
  }
  return new Date(targetUtcMs);
}

export function normalizeWhatsappNumber(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9]/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
  settings: any;
  forceDryRun?: boolean;
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
  dryRun?: boolean;
}

export async function sendEmailMessage(input: SendEmailInput): Promise<SendResult> {
  const recipients = (Array.isArray(input.to) ? input.to : [input.to])
    .map((e) => String(e || '').trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    return { ok: false, error: 'Recipient email address is missing' };
  }

  const s = input.settings || {};
  const isDryRun = Boolean(input.forceDryRun ?? s.dryRunMode);
  if (isDryRun) {
    return {
      ok: true,
      dryRun: true,
      providerMessageId: `dry-email-${Date.now()}`,
    };
  }

  const provider = String(s.emailProvider || 'SMTP').toUpperCase();
  const fromName = s.smtpFromName || s.businessName || 'Aligarh Web Solutions';
  const fromEmail = s.smtpFromEmail || s.smtpUser || process.env.SMTP_USER || '';
  const htmlBody = input.html || plainTextToSafeEmailHtml(input.text, s.businessName);

  try {
    if (provider === 'BREVO') {
      const apiKey =
        (s.emailApiKeyEncrypted ? decryptSecret(s.emailApiKeyEncrypted) : '') ||
        process.env.BREVO_API_KEY ||
        '';
      if (!apiKey) return { ok: false, error: 'Brevo API key not configured in Settings' };
      if (!fromEmail) return { ok: false, error: 'Sender email (From) is not configured' };

      const payload: any = {
        sender: { name: fromName, email: fromEmail },
        to: recipients.map((email) => ({ email })),
        subject: input.subject,
        textContent: input.text,
        htmlContent: htmlBody,
      };
      if (input.attachments && input.attachments.length > 0) {
        payload.attachment = input.attachments.map((a) => ({
          name: a.filename,
          content: a.content.toString('base64'),
        }));
      }

      const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const json: any = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return { ok: false, error: json?.message || `Brevo HTTP ${resp.status}` };
      }
      return { ok: true, providerMessageId: json?.messageId || `brevo-${Date.now()}` };
    }

    if (provider === 'RESEND') {
      const apiKey =
        (s.emailApiKeyEncrypted ? decryptSecret(s.emailApiKeyEncrypted) : '') ||
        process.env.RESEND_API_KEY ||
        '';
      if (!apiKey) return { ok: false, error: 'Resend API key not configured in Settings' };
      if (!fromEmail) return { ok: false, error: 'Sender email (From) is not configured' };

      const payload: any = {
        from: `${fromName} <${fromEmail}>`,
        to: recipients,
        subject: input.subject,
        text: input.text,
        html: htmlBody,
      };
      if (input.attachments && input.attachments.length > 0) {
        payload.attachments = input.attachments.map((a) => ({
          filename: a.filename,
          content: a.content.toString('base64'),
        }));
      }

      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const json: any = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return { ok: false, error: json?.message || `Resend HTTP ${resp.status}` };
      }
      return { ok: true, providerMessageId: json?.id || `resend-${Date.now()}` };
    }

    // Default: SMTP via Nodemailer
    const smtpUser = s.smtpUser || process.env.SMTP_USER;
    const smtpPass =
      (s.smtpPassEncrypted ? decryptSecret(s.smtpPassEncrypted) : '') ||
      process.env.SMTP_PASS ||
      '';
    const smtpHost = s.smtpHost || process.env.SMTP_HOST || 'smtp.hostinger.com';
    const smtpPort = Number(s.smtpPort || process.env.SMTP_PORT || 465);
    const smtpSecure = Boolean(s.smtpSecure ?? true);

    if (!smtpUser || !smtpPass) {
      return { ok: false, error: 'SMTP username or password is not configured in Settings' };
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: { user: smtpUser, pass: smtpPass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
    });

    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail || smtpUser}>`,
      to: recipients.join(', '),
      subject: input.subject,
      text: input.text,
      html: htmlBody,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });

    return { ok: true, providerMessageId: info.messageId || `smtp-${Date.now()}` };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Email delivery failed' };
  }
}

export interface WhatsAppSendParams {
  to: string;
  templateName?: string | null;
  languageCode?: string | null;
  bodyParams?: string[];
  renderedText: string;
  settings: any;
  forceDryRun?: boolean;
}

export interface WhatsAppProvider {
  readonly name: string;
  sendMessage(params: WhatsAppSendParams): Promise<SendResult>;
}

export class MetaWhatsAppCloudProvider implements WhatsAppProvider {
  readonly name = 'META_CLOUD_API';

  async sendMessage(params: WhatsAppSendParams): Promise<SendResult> {
    const normalized = normalizeWhatsappNumber(params.to);
    if (!normalized) {
      return { ok: false, error: 'Recipient WhatsApp phone number is missing or invalid' };
    }

    const s = params.settings || {};
    const isDryRun = Boolean(params.forceDryRun ?? s.dryRunMode);
    if (isDryRun) {
      return {
        ok: true,
        dryRun: true,
        providerMessageId: `dry-wa-${Date.now()}`,
      };
    }

    const phoneNumberId = s.whatsappPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    const accessToken =
      (s.whatsappAccessTokenEnc ? decryptSecret(s.whatsappAccessTokenEnc) : '') ||
      process.env.WHATSAPP_ACCESS_TOKEN ||
      '';

    if (!phoneNumberId || !accessToken) {
      return {
        ok: false,
        error: 'Meta WhatsApp Cloud API credentials (Phone Number ID / Access Token) are not configured',
      };
    }

    try {
      const useTemplate = Boolean(params.templateName);
      const bodyPayload = useTemplate
        ? {
            messaging_product: 'whatsapp',
            to: normalized,
            type: 'template',
            template: {
              name: params.templateName,
              language: { code: params.languageCode || 'en' },
              ...(params.bodyParams && params.bodyParams.length > 0
                ? {
                    components: [
                      {
                        type: 'body',
                        parameters: params.bodyParams.map((txt) => ({
                          type: 'text',
                          text: String(txt || '-').slice(0, 1024),
                        })),
                      },
                    ],
                  }
                : {}),
            },
          }
        : {
            messaging_product: 'whatsapp',
            to: normalized,
            type: 'text',
            text: { preview_url: false, body: params.renderedText.slice(0, 4096) },
          };

      const resp = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId)}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyPayload),
      });

      const json: any = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const apiMsg = json?.error?.message || `WhatsApp Cloud API HTTP ${resp.status}`;
        return { ok: false, error: apiMsg };
      }
      const msgId = json?.messages?.[0]?.id || `wa-${Date.now()}`;
      return { ok: true, providerMessageId: msgId };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'WhatsApp delivery failed' };
    }
  }
}

export const whatsappProvider: WhatsAppProvider = new MetaWhatsAppCloudProvider();
