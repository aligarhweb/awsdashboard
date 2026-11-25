import { getIstDateParts } from './dates';

export type GstModeType = 'CGST_SGST' | 'IGST' | 'NONE';

export interface BillingLineInput {
  itemName?: string | null;
  description: string;
  hsnSac?: string | null;
  qty: number;
  rate: number;
  discount?: number;
  taxPercent: number;
  domainId?: string | null;
  serviceId?: string | null;
}

export interface ComputedLineItem extends BillingLineInput {
  discount: number;
  taxableAmount: number;
  taxAmount: number;
  lineTotal: number;
}

export interface ComputedDocumentTotals {
  gstMode: GstModeType;
  subtotal: number;
  discountTotal: number;
  taxableTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  taxTotal: number;
  roundOff: number;
  total: number;
  items: ComputedLineItem[];
}

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

const INDIAN_STATE_CODES: Record<string, { code: string; name: string }> = {
  'jammu and kashmir': { code: '01', name: 'Jammu and Kashmir' },
  'himachal pradesh': { code: '02', name: 'Himachal Pradesh' },
  'punjab': { code: '03', name: 'Punjab' },
  'chandigarh': { code: '04', name: 'Chandigarh' },
  'uttarakhand': { code: '05', name: 'Uttarakhand' },
  'haryana': { code: '06', name: 'Haryana' },
  'delhi': { code: '07', name: 'Delhi' },
  'rajasthan': { code: '08', name: 'Rajasthan' },
  'uttar pradesh': { code: '09', name: 'Uttar Pradesh' },
  'uttara pradesh': { code: '09', name: 'Uttar Pradesh' },
  'up': { code: '09', name: 'Uttar Pradesh' },
  'bihar': { code: '10', name: 'Bihar' },
  'sikkim': { code: '11', name: 'Sikkim' },
  'arunachal pradesh': { code: '12', name: 'Arunachal Pradesh' },
  'nagaland': { code: '13', name: 'Nagaland' },
  'manipur': { code: '14', name: 'Manipur' },
  'mizoram': { code: '15', name: 'Mizoram' },
  'tripura': { code: '16', name: 'Tripura' },
  'meghalaya': { code: '17', name: 'Meghalaya' },
  'assam': { code: '18', name: 'Assam' },
  'west bengal': { code: '19', name: 'West Bengal' },
  'jharkhand': { code: '20', name: 'Jharkhand' },
  'odisha': { code: '21', name: 'Odisha' },
  'chhattisgarh': { code: '22', name: 'Chhattisgarh' },
  'madhya pradesh': { code: '23', name: 'Madhya Pradesh' },
  'gujarat': { code: '24', name: 'Gujarat' },
  'maharashtra': { code: '27', name: 'Maharashtra' },
  'andhra pradesh': { code: '37', name: 'Andhra Pradesh' },
  'karnataka': { code: '29', name: 'Karnataka' },
  'goa': { code: '30', name: 'Goa' },
  'kerala': { code: '32', name: 'Kerala' },
  'tamil nadu': { code: '33', name: 'Tamil Nadu' },
  'telangana': { code: '36', name: 'Telangana' },
};

export function normalizeStateKey(state?: string | null): string {
  const cleaned = (state || '')
    .trim()
    .replace(/^\d{2}\s*-\s*/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (!cleaned) return '';
  if (cleaned === 'uttara pradesh' || cleaned === 'up' || cleaned === 'u.p.') {
    return 'uttar pradesh';
  }
  if (cleaned === 'dl') return 'delhi';
  return cleaned;
}

export function formatPlaceOfSupply(state?: string | null): string | null {
  const raw = (state || '').trim();
  if (!raw) return null;
  if (/^\d{2}-/.test(raw)) {
    const key = normalizeStateKey(raw);
    const matched = INDIAN_STATE_CODES[key];
    return matched ? `${matched.code}-${matched.name}` : raw;
  }
  const key = normalizeStateKey(raw);
  const matched = INDIAN_STATE_CODES[key];
  if (matched) return `${matched.code}-${matched.name}`;
  return raw;
}

/**
 * Indian Financial Year (April 1 - March 31) in short YY-YY format, e.g. "26-27".
 */
export function getIndianFinancialYear(dateInput: Date | string = new Date()): string {
  const { year, month } = getIstDateParts(dateInput);
  const startYear = month >= 4 ? year : year - 1;
  const endYear = startYear + 1;
  return `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
}

/**
 * Determines default GST mode from business state vs client state / place of supply.
 */
export function resolveDefaultGstMode(
  gstEnabled: boolean,
  businessState?: string | null,
  clientStateOrPlace?: string | null
): GstModeType {
  if (!gstEnabled) return 'NONE';
  const bState = normalizeStateKey(businessState || 'Uttar Pradesh') || 'uttar pradesh';
  const cState = normalizeStateKey(clientStateOrPlace);
  if (!cState || cState === bState) return 'CGST_SGST';
  return 'IGST';
}

export function computeDocumentTotals(
  rawItems: BillingLineInput[],
  gstMode: GstModeType,
  applyRoundOff = true,
  adjustmentOverride?: number | null
): ComputedDocumentTotals {
  let subtotal = 0;
  let discountTotal = 0;
  let taxableTotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;
  let taxTotal = 0;

  const items: ComputedLineItem[] = rawItems.map((raw) => {
    const qty = Math.max(0, Number(raw.qty) || 0);
    const rate = Math.max(0, Number(raw.rate) || 0);
    const gross = round2(qty * rate);
    const discount = Math.min(gross, Math.max(0, Number(raw.discount) || 0));
    const taxable = round2(gross - discount);
    const taxPct = gstMode === 'NONE' ? 0 : Math.max(0, Number(raw.taxPercent) || 0);

    let lineCgst = 0;
    let lineSgst = 0;
    let lineIgst = 0;
    let taxAmt = 0;

    if (gstMode === 'CGST_SGST') {
      const halfRate = taxPct / 2;
      lineCgst = round2(taxable * (halfRate / 100));
      lineSgst = round2(taxable * (halfRate / 100));
      taxAmt = round2(lineCgst + lineSgst);
    } else if (gstMode === 'IGST') {
      lineIgst = round2(taxable * (taxPct / 100));
      taxAmt = lineIgst;
    }

    const lineTotal = round2(taxable + taxAmt);

    subtotal = round2(subtotal + gross);
    discountTotal = round2(discountTotal + discount);
    taxableTotal = round2(taxableTotal + taxable);
    cgstTotal = round2(cgstTotal + lineCgst);
    sgstTotal = round2(sgstTotal + lineSgst);
    igstTotal = round2(igstTotal + lineIgst);
    taxTotal = round2(taxTotal + taxAmt);

    return {
      itemName: raw.itemName?.trim() || null,
      description: raw.description.trim(),
      hsnSac: raw.hsnSac?.trim() || null,
      qty,
      rate,
      discount,
      taxPercent: taxPct,
      taxableAmount: taxable,
      taxAmount: taxAmt,
      lineTotal,
      domainId: raw.domainId || null,
      serviceId: raw.serviceId || null,
    };
  });

  const preRound = round2(taxableTotal + taxTotal);
  const hasExplicitAdjustment =
    adjustmentOverride !== undefined &&
    adjustmentOverride !== null &&
    Number.isFinite(Number(adjustmentOverride));

  let roundOff = 0;
  let total = preRound;
  if (hasExplicitAdjustment) {
    roundOff = round2(Number(adjustmentOverride));
    total = round2(preRound + roundOff);
  } else if (applyRoundOff) {
    total = Math.round(preRound);
    roundOff = round2(total - preRound);
  }

  return {
    gstMode,
    subtotal,
    discountTotal,
    taxableTotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    taxTotal,
    roundOff,
    total,
    items,
  };
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitsWords(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o > 0 ? `${TENS[t]} ${ONES[o]}` : TENS[t];
}

function integerToIndianWords(num: number): string {
  if (num === 0) return 'Zero';
  let n = Math.floor(Math.abs(num));
  const parts: string[] = [];

  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = Math.floor(n / 100);
  const rem = n % 100;

  if (crore > 0) parts.push(`${integerToIndianWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigitsWords(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigitsWords(thousand)} Thousand`);
  if (hundred > 0) parts.push(`${ONES[hundred]} Hundred`);
  if (rem > 0) {
    if (parts.length > 0) parts.push('and');
    parts.push(twoDigitsWords(rem));
  }

  return parts.join(' ');
}

/**
 * Converts a monetary amount into Indian Rupees & Paise words.
 */
export function amountInWordsINR(amount: number | string): string {
  const num = round2(Math.max(0, Number(amount) || 0));
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);

  if (paise > 0) {
    return `Rupees ${integerToIndianWords(rupees)} and ${twoDigitsWords(paise)} Paise Only`;
  }
  return `Rupees ${integerToIndianWords(rupees)} Only`;
}

/**
 * Generates a standard NPCI UPI deep link URI.
 */
export function buildUpiUri(params: {
  upiId: string;
  payeeName: string;
  amount: number;
  note: string;
}): string {
  const query = new URLSearchParams({
    pa: params.upiId.trim(),
    pn: params.payeeName.trim(),
    cu: 'INR',
    tn: params.note.trim(),
  });
  if (params.amount > 0) {
    query.set('am', round2(params.amount).toFixed(2));
  }
  return `upi://pay?${query.toString()}`;
}
