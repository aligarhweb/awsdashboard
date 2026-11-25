import { describe, expect, it } from 'vitest';
import {
  amountInWordsINR,
  buildUpiUri,
  computeDocumentTotals,
  getIndianFinancialYear,
  resolveDefaultGstMode,
} from '../shared/billing';
import { deriveInvoiceStatus } from '../server/lib/billingHelpers';
import {
  generateEstimatePdfBuffer,
  generateInvoicePdfBuffer,
  generateReceiptPdfBuffer,
} from '../server/lib/pdfGenerator';

describe('Indian Financial Year & GST Mode Logic', () => {
  it('computes Indian FY across March 31 / April 1 boundary in IST', () => {
    expect(getIndianFinancialYear(new Date('2026-03-31T10:00:00.000Z'))).toBe('25-26');
    expect(getIndianFinancialYear(new Date('2026-04-01T10:00:00.000Z'))).toBe('26-27');
    expect(getIndianFinancialYear(new Date('2026-03-31T19:00:00.000Z'))).toBe('26-27'); // 01-Apr-2026 00:30 IST
  });

  it('selects CGST+SGST for intra-state, IGST for inter-state, and NONE when GST disabled', () => {
    expect(resolveDefaultGstMode(true, 'Uttar Pradesh', 'Uttar Pradesh')).toBe('CGST_SGST');
    expect(resolveDefaultGstMode(true, 'Uttar Pradesh', 'Maharashtra')).toBe('IGST');
    expect(resolveDefaultGstMode(false, 'Uttar Pradesh', 'Delhi')).toBe('NONE');
  });
});

describe('Document Totals, Indian Words & UPI Deep Links', () => {
  it('calculates CGST+SGST, discounts, and round-off accurately', () => {
    const res = computeDocumentTotals(
      [
        { description: 'Domain Renewal', hsnSac: '998314', qty: 1, rate: 1200, discount: 100, taxPercent: 18 },
        { description: 'Business Hosting', hsnSac: '998315', qty: 1, rate: 4999, discount: 0, taxPercent: 18 },
      ],
      'CGST_SGST',
      true
    );

    expect(res.subtotal).toBe(6199);
    expect(res.discountTotal).toBe(100);
    expect(res.taxableTotal).toBe(6099);
    expect(res.taxTotal).toBe(1097.82);
    expect(res.cgstTotal).toBe(548.91);
    expect(res.sgstTotal).toBe(548.91);
    expect(res.igstTotal).toBe(0);
    // 6099 + 1097.82 = 7196.82 -> rounds to 7197 (+0.18)
    expect(res.total).toBe(7197);
    expect(res.roundOff).toBe(0.18);
  });

  it('calculates IGST and zero-tax NONE modes cleanly', () => {
    const igst = computeDocumentTotals(
      [{ description: 'AMC', qty: 2, rate: 5000, discount: 0, taxPercent: 18 }],
      'IGST',
      false
    );
    expect(igst.cgstTotal).toBe(0);
    expect(igst.sgstTotal).toBe(0);
    expect(igst.igstTotal).toBe(1800);
    expect(igst.total).toBe(11800);

    const none = computeDocumentTotals(
      [{ description: 'AMC', qty: 2, rate: 5000, discount: 0, taxPercent: 18 }],
      'NONE',
      false
    );
    expect(none.taxTotal).toBe(0);
    expect(none.total).toBe(10000);
  });

  it('formats Rupees and Paise in Indian Lakh/Crore numbering words', () => {
    expect(amountInWordsINR(124500)).toBe('Rupees One Lakh Twenty Four Thousand Five Hundred Only');
    expect(amountInWordsINR(10000000)).toBe('Rupees One Crore Only');
    expect(amountInWordsINR(749.5)).toBe('Rupees Seven Hundred and Forty Nine and Fifty Paise Only');
  });

  it('builds a valid NPCI UPI payment URI', () => {
    const uri = buildUpiUri({
      upiId: 'aws@icici',
      payeeName: 'Aligarh Web Solutions',
      amount: 7197,
      note: 'INV-26-27-0001',
    });
    expect(uri.startsWith('upi://pay?')).toBe(true);
    expect(uri).toContain('pa=aws%40icici');
    expect(uri).toContain('am=7197.00');
    expect(uri).toContain('cu=INR');
    expect(uri).toContain('tn=INV-26-27-0001');
  });
});

describe('Invoice Status Derivation', () => {
  it('transitions statuses accurately across partial, full, overdue, and cancelled states', () => {
    const now = new Date('2026-11-24T10:00:00.000Z');
    const future = new Date('2026-12-05T10:00:00.000Z');
    const past = new Date('2026-11-01T10:00:00.000Z');

    expect(
      deriveInvoiceStatus({ currentStatus: 'DRAFT', total: 5000, amountPaid: 0, dueDate: past, now })
    ).toBe('DRAFT');
    expect(
      deriveInvoiceStatus({ currentStatus: 'SENT', total: 5000, amountPaid: 2000, dueDate: future, now })
    ).toBe('PARTIALLY_PAID');
    expect(
      deriveInvoiceStatus({ currentStatus: 'SENT', total: 5000, amountPaid: 5000, dueDate: past, now })
    ).toBe('PAID');
    expect(
      deriveInvoiceStatus({ currentStatus: 'SENT', total: 5000, amountPaid: 0, dueDate: past, now })
    ).toBe('OVERDUE');
    expect(
      deriveInvoiceStatus({ currentStatus: 'CANCELLED', total: 5000, amountPaid: 0, dueDate: past, now })
    ).toBe('CANCELLED');
  });
});

describe('Pure-JS PDF Generation (pdfkit)', () => {
  const sampleSettings = {
    businessName: 'Aligarh Web Solutions',
    businessState: 'Uttar Pradesh',
    address: 'Civil Lines, Aligarh, UP 202001',
    gstin: '09ABCDE1234F1Z5',
    pan: 'ABCDE1234F',
    bankName: 'HDFC Bank',
    bankAccountNumber: '50200012345678',
    bankIfsc: 'HDFC0000123',
    bankAccountName: 'Aligarh Web Solutions',
    upiId: 'aligarhweb@hdfcbank',
  };

  const sampleClient = {
    name: 'Institute of Ophthalmology',
    company: 'AMU Campus',
    address: 'Aligarh, UP 202002',
    state: 'Uttar Pradesh',
    gstin: '09XYZAB1234K1Z2',
    emails: ['amuio2011@gmail.com'],
    whatsappPhone: '+919634911152',
  };

  it('generates valid Invoice, Estimate, and Payment Receipt PDF buffers', async () => {
    const invBuf = await generateInvoicePdfBuffer(
      {
        invoiceNumber: 'INV-26-27-0001',
        financialYear: '26-27',
        issueDate: '2026-11-24T00:00:00.000Z',
        dueDate: '2026-12-01T00:00:00.000Z',
        gstMode: 'CGST_SGST',
        subtotal: 1200,
        discountTotal: 0,
        cgstTotal: 108,
        sgstTotal: 108,
        igstTotal: 0,
        taxTotal: 216,
        roundOff: 0,
        total: 1416,
        amountPaid: 0,
        status: 'SENT',
        client: sampleClient,
        items: [
          {
            description: 'Domain Renewal: example.in (1 Year)',
            hsnSac: '998314',
            qty: 1,
            rate: 1200,
            discount: 0,
            taxPercent: 18,
            lineTotal: 1416,
          },
        ],
      },
      sampleSettings
    );

    expect(Buffer.isBuffer(invBuf)).toBe(true);
    expect(invBuf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(invBuf.length).toBeGreaterThan(1500);

    const estBuf = await generateEstimatePdfBuffer(
      {
        estimateNumber: 'EST-2026-0001',
        issueDate: '2026-11-24T00:00:00.000Z',
        validUntil: '2026-12-09T00:00:00.000Z',
        gstMode: 'CGST_SGST',
        subtotal: 10000,
        discountTotal: 0,
        taxTotal: 1800,
        roundOff: 0,
        total: 11800,
        status: 'SENT',
        client: sampleClient,
        items: [
          {
            description: 'Corporate Website Redesign',
            hsnSac: '998313',
            qty: 1,
            rate: 10000,
            discount: 0,
            taxPercent: 18,
            lineTotal: 11800,
          },
        ],
      },
      sampleSettings
    );
    expect(estBuf.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const rcptBuf = await generateReceiptPdfBuffer(
      {
        receiptNumber: 'RCPT-2026-0001',
        paidAt: '2026-11-24T00:00:00.000Z',
        method: 'UPI',
        amount: 1416,
        referenceUtr: '432910884122',
        client: sampleClient,
      },
      { invoiceNumber: 'INV-26-27-0001', total: 1416, amountPaid: 1416 },
      sampleSettings
    );
    expect(rcptBuf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
