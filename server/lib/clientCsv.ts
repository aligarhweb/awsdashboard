import Papa from 'papaparse';
import { z } from 'zod';

export const clientInputSchema = z.object({
  name: z.string().trim().min(1, 'Client name is required').max(191),
  company: z.string().trim().max(191).optional().nullable(),
  contactPerson: z.string().trim().max(191).optional().nullable(),
  emails: z.array(z.string().trim().email()).min(0).default([]),
  whatsappPhone: z
    .string()
    .trim()
    .regex(/^\+?[1-9]\d{6,14}$/, 'Use E.164 phone format like +919837011223')
    .optional()
    .nullable()
    .or(z.literal('')),
  secondaryPhones: z.array(z.string().trim()).optional().default([]),
  address: z.string().trim().max(2000).optional().nullable(),
  state: z.string().trim().max(100).optional().nullable(),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid 15-char GSTIN')
    .optional()
    .nullable()
    .or(z.literal('')),
  notes: z.string().trim().max(5000).optional().nullable(),
  preferredChannel: z.enum(['EMAIL', 'WHATSAPP', 'BOTH']).default('BOTH'),
  remindersEnabled: z.boolean().default(true),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).default('ACTIVE'),
  tags: z.array(z.string().trim()).optional().default([]),
});

export type ClientCsvRecord = z.infer<typeof clientInputSchema>;

export interface ParsedClientCsvRow {
  rowNumber: number;
  valid: boolean;
  error?: string;
  zohoContactId?: string;
  data?: ClientCsvRecord;
}

const GENERIC_DISPLAY_NAMES = new Set([
  'director',
  'the editor',
  'editor',
  'the chairman',
  'chairman',
  'manager',
  'principal',
  'the principal',
  'coordinator',
]);

function isGenericDisplayName(displayName: string): boolean {
  const lower = displayName.trim().toLowerCase();
  return (
    GENERIC_DISPLAY_NAMES.has(lower) ||
    lower.startsWith('project coordinator') ||
    lower.startsWith('the ')
  );
}

export function cleanPhoneRaw(raw?: string | null): string {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/^'+/, '')
    .replace(/[\s()-]+/g, '');
}

/**
 * Normalizes Indian & international phone numbers from Zoho/Excel exports.
 * Distinguishes WhatsApp-capable mobile numbers from landlines (e.g. 0571-2900120, +91-571-2721136).
 */
export function classifyPhone(raw?: string | null): {
  e164Mobile: string | null;
  secondary: string | null;
} {
  const cleaned = cleanPhoneRaw(raw);
  if (!cleaned) return { e164Mobile: null, secondary: null };

  // Strip optional leading '+' for inspection
  const digits = cleaned.replace(/^\+/, '').replace(/\D/g, '');
  if (!digits || digits.length < 7) return { e164Mobile: null, secondary: null };

  // 10-digit Indian mobile starting with 6-9
  if (/^[6-9]\d{9}$/.test(digits)) {
    return { e164Mobile: `+91${digits}`, secondary: null };
  }

  // 12-digit Indian mobile starting with 91[6-9]...
  if (/^91[6-9]\d{9}$/.test(digits)) {
    return { e164Mobile: `+${digits}`, secondary: null };
  }

  // 11-digit with leading 0 + Indian mobile (09837...)
  if (/^0[6-9]\d{9}$/.test(digits)) {
    return { e164Mobile: `+91${digits.slice(1)}`, secondary: null };
  }

  // Landline (e.g. 0571-..., +91-571-..., +91-5734-...) -> secondary phone
  if (cleaned.startsWith('+')) {
    return { e164Mobile: null, secondary: `+${digits}` };
  }
  return { e164Mobile: null, secondary: cleaned };
}

export function normalizeIndianState(raw?: string | null, fallbackPlace?: string | null): string | null {
  const candidate = (raw || '').trim() || (fallbackPlace || '').trim();
  if (!candidate) return null;

  const strippedCode = candidate.replace(/^\d{2}-/, '').trim();
  const upper = strippedCode.toUpperCase();

  if (upper === 'UP' || upper === 'UTTAR PRADESH' || upper === 'UTTARA PRADESH') {
    return 'Uttar Pradesh';
  }
  if (upper === 'DL' || upper === 'DELHI') return 'Delhi';

  // Title case all-caps state names
  if (strippedCode === strippedCode.toUpperCase()) {
    return strippedCode
      .toLowerCase()
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  return strippedCode;
}

function normalizeWebsite(raw?: string | null): string | null {
  const w = (raw || '').trim().replace(/\.+$/, '');
  return w || null;
}

function formatZohoAddress(r: Record<string, string>, normalizedState: string | null): string | null {
  const direct = (r.address || '').trim();
  if (direct) return direct;

  const rawParts = [
    r.billing_address,
    r.billing_street2,
    r.billing_city,
    normalizedState || r.billing_state,
    r.billing_code,
    r.billing_country,
  ]
    .map((p) => (p || '').replace(/\r?\n+/g, ', ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const deduped: string[] = [];
  for (const part of rawParts) {
    if (!deduped.some((existing) => existing.toLowerCase() === part.toLowerCase())) {
      deduped.push(part);
    }
  }

  return deduped.length > 0 ? deduped.join(', ') : null;
}

export function parseClientCsv(csvText: string): ParsedClientCsvRow[] {
  const parsedCsv = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  });

  const rows: ParsedClientCsvRow[] = [];

  for (let i = 0; i < parsedCsv.data.length; i++) {
    const r = parsedCsv.data[i];
    const isZohoRow =
      'display_name' in r ||
      'company_name' in r ||
      'emailid' in r ||
      'contact_id' in r ||
      'mobilephone' in r;

    const displayName = (r.display_name || '').trim();
    const companyName = (r.company_name || r.company || '').trim();
    const personParts = [r.salutation, r.first_name, r.last_name]
      .map((s) => (s || '').trim())
      .filter(Boolean)
      .join(' ')
      .trim();
    const billingAttention = (r.billing_attention || '').trim();

    let name = (r.name || r.client_name || '').trim();
    let company: string | null = companyName || null;
    let contactPerson: string | null = (r.contact_person || r.contactperson || '').trim() || null;

    if (!name && isZohoRow) {
      if (displayName && companyName && isGenericDisplayName(displayName)) {
        name = companyName;
        contactPerson =
          contactPerson ||
          (personParts && personParts.toLowerCase() !== name.toLowerCase() ? personParts : null) ||
          (billingAttention || displayName);
      } else {
        name = displayName || companyName;
        if (!contactPerson) {
          if (personParts && personParts.toLowerCase() !== name.toLowerCase()) {
            contactPerson = personParts;
          } else if (billingAttention && billingAttention.toLowerCase() !== name.toLowerCase()) {
            contactPerson = billingAttention;
          }
        }
      }
    }

    const emailsRaw = r.emails || r.email || r.emailid || '';
    const emails = emailsRaw
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    // Phone resolution (prioritize mobile for WhatsApp, keep landlines/extras in secondaryPhones)
    const phoneCandidates = [
      r.whatsapp_phone,
      r.whatsapp,
      r.mobilephone,
      r.billing_phone,
      r.phone,
      r.shipping_phone,
    ];
    let whatsappPhone: string | null = null;
    const secondarySet = new Set<string>();

    for (const rawPhone of phoneCandidates) {
      const { e164Mobile, secondary } = classifyPhone(rawPhone);
      if (e164Mobile) {
        if (!whatsappPhone) {
          whatsappPhone = e164Mobile;
        } else if (e164Mobile !== whatsappPhone) {
          secondarySet.add(e164Mobile);
        }
      } else if (secondary) {
        secondarySet.add(secondary);
      }
    }

    const state = normalizeIndianState(
      r.state || r.billing_state,
      r['place_of_contact(with_state_code)'] || r.place_of_contact
    );
    const address = formatZohoAddress(r, state);
    const gstin = (r.gstin || r['gst_identification_number_(gstin)'] || '').trim() || null;

    const noteParts: string[] = [];
    const website = normalizeWebsite(r.website);
    if (website) noteParts.push(`Website: ${website}`);
    const paymentTerms = (r.payment_terms_label || '').trim();
    if (paymentTerms && paymentTerms.toLowerCase() !== 'due on receipt') {
      noteParts.push(`Payment Terms: ${paymentTerms}`);
    }
    const zohoContactId = (r.contact_id || '').trim() || undefined;
    if (zohoContactId) noteParts.push(`Zoho Contact ID: ${zohoContactId}`);
    const rawNotes = (r.notes || '').trim();
    if (rawNotes) noteParts.push(rawNotes);

    const tags = (r.tags || '')
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (tags.length === 0 && zohoContactId) {
      tags.push('zoho-books');
    }

    const channelRaw = (r.preferred_channel || r.preferredchannel || 'BOTH').toUpperCase();
    const preferredChannel = ['EMAIL', 'WHATSAPP', 'BOTH'].includes(channelRaw)
      ? (channelRaw as 'EMAIL' | 'WHATSAPP' | 'BOTH')
      : 'BOTH';

    const statusRaw = (r.status || 'ACTIVE').trim().toUpperCase();
    const status = (['ACTIVE', 'INACTIVE', 'ARCHIVED'].includes(statusRaw)
      ? statusRaw
      : 'ACTIVE') as 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

    const candidate = {
      name: name.slice(0, 191),
      company: company ? company.slice(0, 191) : null,
      contactPerson: contactPerson ? contactPerson.slice(0, 191) : null,
      emails,
      whatsappPhone,
      secondaryPhones: Array.from(secondarySet),
      address,
      state,
      gstin,
      notes: noteParts.length > 0 ? noteParts.join('\n').slice(0, 5000) : null,
      preferredChannel,
      remindersEnabled: (r.reminders_enabled || 'true').toLowerCase() !== 'false',
      status,
      tags,
    };

    const v = clientInputSchema.safeParse(candidate);
    if (!v.success) {
      const firstErr = Object.values(v.error.flatten().fieldErrors).flat()[0] || 'Validation failed';
      rows.push({
        rowNumber: i + 2,
        valid: false,
        error: firstErr,
        zohoContactId,
        data: candidate as any,
      });
    } else {
      rows.push({
        rowNumber: i + 2,
        valid: true,
        zohoContactId,
        data: v.data,
      });
    }
  }

  return rows;
}
