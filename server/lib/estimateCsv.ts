import Papa from 'papaparse';
import { db } from '../db';
import {
  BillingLineInput,
  computeDocumentTotals,
  formatPlaceOfSupply,
  GstModeType,
  resolveDefaultGstMode,
  round2,
} from '../../shared/billing';
import { generateRandomToken } from './crypto';
import { EstimateStatus } from '../../shared/types';

export interface ParsedEstimateLine {
  itemName: string | null;
  description: string;
  hsnSac: string | null;
  qty: number;
  rate: number;
  discount: number;
  taxPercent: number;
}

export interface ParsedEstimateRecord {
  rowNumber: number;
  valid: boolean;
  error?: string;
  estimateNumber: string;
  zohoEstimateId?: string;
  zohoCustomerId?: string;
  customerName: string;
  customerAddress?: string | null;
  customerState?: string | null;
  customerGstin?: string | null;
  issueDate: string;
  validUntil: string;
  status: EstimateStatus;
  referenceNumber: string | null;
  projectName: string | null;
  placeOfSupply: string | null;
  gstMode: GstModeType;
  adjustment: number | null;
  adjustmentLabel: string | null;
  notes: string | null;
  terms: string | null;
  csvSubtotal?: number;
  csvTotal?: number;
  items: ParsedEstimateLine[];
  computedTotal: number;
}

function mapEstimateStatus(raw?: string | null): EstimateStatus {
  const s = (raw || '').trim().toUpperCase();
  if (s === 'DRAFT') return 'DRAFT';
  if (s === 'SENT') return 'SENT';
  if (s === 'VIEWED') return 'VIEWED';
  if (s === 'ACCEPTED' || s === 'INVOICED' || s === 'APPROVED') return 'ACCEPTED';
  if (s === 'REJECTED' || s === 'DECLINED') return 'REJECTED';
  if (s === 'EXPIRED') return 'EXPIRED';
  return 'DRAFT';
}

function cleanZohoItemDesc(raw?: string | null): string {
  if (!raw) return '';
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/^'(?=[-•*])/, '')
    .trim();
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseNumber(val?: string | null, fallback = 0): number {
  if (val === undefined || val === null || val === '') return fallback;
  const n = Number(String(val).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : fallback;
}

function normalizeDateIso(raw?: string | null): string | null {
  const s = (raw || '').trim();
  if (!s) return null;
  const d = new Date(s.length === 10 ? `${s}T00:00:00.000Z` : s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function parseEstimateCsv(
  csvText: string,
  businessState = 'Uttar Pradesh',
  gstEnabled = true
): ParsedEstimateRecord[] {
  const parsedCsv = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  });

  const groups = new Map<
    string,
    {
      firstRowNumber: number;
      rows: Record<string, string>[];
    }
  >();

  parsedCsv.data.forEach((r, idx) => {
    const estId = (r.estimate_id || '').trim();
    const estNum = (r.estimate_number || r['estimate_#'] || '').trim();
    const key = estId || estNum || `row-${idx + 2}`;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(r);
    } else {
      groups.set(key, { firstRowNumber: idx + 2, rows: [r] });
    }
  });

  const results: ParsedEstimateRecord[] = [];

  for (const [, group] of groups.entries()) {
    const head = group.rows[0];
    const estimateNumber = (head.estimate_number || head['estimate_#'] || '').trim();
    const zohoEstimateId = (head.estimate_id || '').trim() || undefined;
    const zohoCustomerId = (head.customer_id || '').trim() || undefined;
    const customerName = (head.customer_name || head.client || head.client_name || '').trim();
    const issueIso = normalizeDateIso(head.estimate_date || head.issue_date);
    const expiryIso =
      normalizeDateIso(head.expiry_date || head.valid_until) ||
      (issueIso ? addDaysIso(issueIso, 15) : '');

    const rawPlace =
      (head['place_of_supply(with_state_code)'] || head.place_of_supply || head.billing_state || '').trim();
    const placeOfSupply = formatPlaceOfSupply(rawPlace);

    const addressParts = [
      head.billing_address,
      head.billing_city,
      head.billing_state,
      head.billing_code,
      head.billing_country,
    ]
      .map((p) => (p || '').replace(/\r?\n+/g, ', ').trim())
      .filter(Boolean);
    const customerAddress = addressParts.length > 0 ? addressParts.join(', ') : null;
    const customerGstin = (head['gst_identification_number_(gstin)'] || head.gstin || '').trim() || null;

    const status = mapEstimateStatus(head.estimate_status || head.status);
    const referenceNumber = (head.purchaseorder || head.reference_number || '').trim() || null;
    const projectName = (head.project_name || '').trim() || null;
    const notes = (head.notes || '').replace(/\r\n/g, '\n').trim() || null;
    const terms = (head['terms_&_conditions'] || head.terms || '').replace(/\r\n/g, '\n').trim() || null;

    const hasAdjustmentCol =
      head.adjustment !== undefined && head.adjustment !== null && String(head.adjustment).trim() !== '';
    const adjustmentVal = hasAdjustmentCol ? round2(parseNumber(head.adjustment, 0)) : null;
    const adjustmentLabel =
      (head.adjustment_description || head.adjustment_label || '').trim() ||
      (adjustmentVal !== null && adjustmentVal !== 0 ? 'Adjustment' : null);

    let hasIgstAmt = false;
    let hasCgstSgstAmt = false;
    let hasTaxPercent = false;

    const items: ParsedEstimateLine[] = [];
    for (const r of group.rows) {
      const itemName = (r.item_name || '').trim() || null;
      const cleanedDesc = cleanZohoItemDesc(r.item_desc || r.description);
      const description = cleanedDesc || itemName || '';
      const hsnSac = (r['hsn/sac'] || r.hsn_sac || '').trim() || null;
      const qty = parseNumber(r.quantity ?? r.qty, 1);
      const rate = parseNumber(r.item_price ?? r.rate, 0);
      // Use flat Discount Amount when present (Zoho `Discount` column can hold percentage while `Discount Amount` is flat ₹)
      const discountAmt =
        r.discount_amount !== undefined && r.discount_amount !== ''
          ? parseNumber(r.discount_amount, 0)
          : parseNumber(r.discount, 0);
      const taxPercent = parseNumber(r['item_tax_%'] ?? r.tax_percent, 0);

      if (parseNumber(r.igst, 0) > 0) hasIgstAmt = true;
      if (parseNumber(r.cgst, 0) > 0 || parseNumber(r.sgst, 0) > 0) hasCgstSgstAmt = true;
      if (taxPercent > 0) hasTaxPercent = true;

      if (description || rate > 0) {
        items.push({
          itemName,
          description: description || 'Service',
          hsnSac,
          qty: qty > 0 ? qty : 1,
          rate: Math.max(0, rate),
          discount: Math.max(0, round2(discountAmt)),
          taxPercent: Math.max(0, taxPercent),
        });
      }
    }

    let gstMode: GstModeType;
    if (!gstEnabled || (!hasTaxPercent && !hasIgstAmt && !hasCgstSgstAmt)) {
      gstMode = 'NONE';
    } else if (hasIgstAmt) {
      gstMode = 'IGST';
    } else if (hasCgstSgstAmt) {
      gstMode = 'CGST_SGST';
    } else {
      gstMode = resolveDefaultGstMode(gstEnabled, businessState, placeOfSupply || head.billing_state);
    }

    const lineInputs: BillingLineInput[] = items.map((it) => ({
      itemName: it.itemName,
      description: it.description,
      hsnSac: it.hsnSac,
      qty: it.qty,
      rate: it.rate,
      discount: it.discount,
      taxPercent: it.taxPercent,
    }));

    const totals = computeDocumentTotals(
      lineInputs,
      gstMode,
      adjustmentVal === null,
      adjustmentVal
    );

    const csvSubtotal = head.subtotal !== undefined && head.subtotal !== '' ? parseNumber(head.subtotal) : undefined;
    const csvTotal = head.total !== undefined && head.total !== '' ? parseNumber(head.total) : undefined;

    let error: string | undefined;
    if (!estimateNumber) error = 'Missing Estimate Number';
    else if (!customerName) error = 'Missing Customer Name';
    else if (!issueIso) error = 'Invalid or missing Estimate Date';
    else if (items.length === 0) error = 'No valid line items found';

    results.push({
      rowNumber: group.firstRowNumber,
      valid: !error,
      error,
      estimateNumber,
      zohoEstimateId,
      zohoCustomerId,
      customerName,
      customerAddress,
      customerState: placeOfSupply ? placeOfSupply.replace(/^\d{2}-/, '') : null,
      customerGstin,
      issueDate: issueIso || '',
      validUntil: expiryIso || '',
      status,
      referenceNumber,
      projectName,
      placeOfSupply,
      gstMode,
      adjustment: adjustmentVal,
      adjustmentLabel,
      notes,
      terms,
      csvSubtotal,
      csvTotal,
      items,
      computedTotal: totals.total,
    });
  }

  return results;
}

export async function importEstimatesFromCsv(csvText: string): Promise<{
  totalCount: number;
  createdCount: number;
  skippedCount: number;
  createdClientsCount: number;
  mismatches: Array<{ estimateNumber: string; csvTotal: number; computedTotal: number }>;
}> {
  const settings = await db.settings.findUnique({ where: { id: 1 } });
  const businessState = settings?.businessState || 'Uttar Pradesh';
  const gstEnabled = Boolean(settings?.gstEnabled ?? true);

  const parsed = parseEstimateCsv(csvText, businessState, gstEnabled);
  const existingClients = await db.client.findMany();
  const existingEstimates = await db.estimate.findMany({
    select: { id: true, estimateNumber: true, zohoEstimateId: true },
  });

  const clientByZohoId = new Map<string, any>();
  const clientByName = new Map<string, any>();
  const clientByCompany = new Map<string, any>();

  for (const c of existingClients as any[]) {
    const m = String(c.notes || '').match(/Zoho Contact ID:\s*(\S+)/);
    if (m?.[1]) clientByZohoId.set(m[1], c);
    if (c.name) clientByName.set(String(c.name).trim().toLowerCase(), c);
    if (c.company) clientByCompany.set(String(c.company).trim().toLowerCase(), c);
  }

  const seenEstimateNumbers = new Set(
    (existingEstimates as any[]).map((e) => String(e.estimateNumber || '').trim().toUpperCase())
  );
  const seenZohoEstIds = new Set(
    (existingEstimates as any[]).map((e) => e.zohoEstimateId).filter(Boolean)
  );

  let createdCount = 0;
  let skippedCount = 0;
  let createdClientsCount = 0;
  const mismatches: Array<{ estimateNumber: string; csvTotal: number; computedTotal: number }> = [];

  for (const est of parsed) {
    if (!est.valid) {
      skippedCount += 1;
      continue;
    }

    const normEstNum = est.estimateNumber.toUpperCase();
    if (
      seenEstimateNumbers.has(normEstNum) ||
      (est.zohoEstimateId && seenZohoEstIds.has(est.zohoEstimateId))
    ) {
      skippedCount += 1;
      continue;
    }

    let client =
      (est.zohoCustomerId && clientByZohoId.get(est.zohoCustomerId)) ||
      clientByName.get(est.customerName.toLowerCase()) ||
      clientByCompany.get(est.customerName.toLowerCase());

    if (!client) {
      client = await db.client.create({
        data: {
          name: est.customerName.slice(0, 191),
          company: est.customerName.slice(0, 191),
          emails: [],
          secondaryPhones: [],
          address: est.customerAddress || null,
          state: est.customerState || null,
          gstin: est.customerGstin || null,
          notes: est.zohoCustomerId ? `Zoho Contact ID: ${est.zohoCustomerId}` : null,
          preferredChannel: 'EMAIL',
          remindersEnabled: true,
          status: 'ACTIVE',
          tags: ['zoho-books'],
          publicStatusToken: generateRandomToken(16),
          isDemo: false,
        },
      });
      if (est.zohoCustomerId) clientByZohoId.set(est.zohoCustomerId, client);
      clientByName.set(est.customerName.toLowerCase(), client);
      createdClientsCount += 1;
    }

    const totals = computeDocumentTotals(
      est.items,
      est.gstMode,
      est.adjustment === null,
      est.adjustment
    );

    if (est.csvTotal !== undefined && Math.abs(totals.total - est.csvTotal) > 0.05) {
      mismatches.push({
        estimateNumber: est.estimateNumber,
        csvTotal: est.csvTotal,
        computedTotal: totals.total,
      });
    }

    await db.estimate.create({
      data: {
        estimateNumber: est.estimateNumber,
        zohoEstimateId: est.zohoEstimateId || null,
        clientId: client.id,
        referenceNumber: est.referenceNumber,
        projectName: est.projectName,
        placeOfSupply: est.placeOfSupply || formatPlaceOfSupply(client.state),
        issueDate: new Date(`${est.issueDate}T00:00:00.000Z`),
        validUntil: new Date(`${est.validUntil}T00:00:00.000Z`),
        gstMode: totals.gstMode,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        roundOff: totals.roundOff,
        adjustmentLabel: est.adjustmentLabel,
        total: totals.total,
        notes: est.notes,
        terms: est.terms || settings?.defaultEstimateTerms || null,
        status: est.status,
        publicToken: generateRandomToken(20),
        items: {
          create: totals.items.map((it, idx) => ({
            itemName: it.itemName || null,
            description: it.description,
            hsnSac: it.hsnSac || null,
            qty: it.qty,
            rate: it.rate,
            discount: it.discount,
            taxPercent: it.taxPercent,
            lineTotal: it.lineTotal,
            sortOrder: idx,
          })),
        },
      },
    });

    seenEstimateNumbers.add(normEstNum);
    if (est.zohoEstimateId) seenZohoEstIds.add(est.zohoEstimateId);
    createdCount += 1;
  }

  return {
    totalCount: parsed.length,
    createdCount,
    skippedCount,
    createdClientsCount,
    mismatches,
  };
}
