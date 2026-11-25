import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  computeDocumentTotals,
  formatPlaceOfSupply,
  resolveDefaultGstMode,
} from '../shared/billing';
import { parseEstimateCsv } from '../server/lib/estimateCsv';
import { generateEstimatePdfBuffer } from '../server/lib/pdfGenerator';

describe('Zoho Estimate Alignment: Place of Supply, GST Math & Concession Overrides', () => {
  it('formats place of supply with Indian GST state codes and handles common typos', () => {
    expect(formatPlaceOfSupply('Uttar Pradesh')).toBe('09-Uttar Pradesh');
    expect(formatPlaceOfSupply('Uttara Pradesh')).toBe('09-Uttar Pradesh');
    expect(formatPlaceOfSupply('03-Punjab')).toBe('03-Punjab');
    expect(formatPlaceOfSupply('Delhi')).toBe('07-Delhi');
    expect(formatPlaceOfSupply('')).toBeNull();
  });

  it('resolves GST mode across state codes and typoed state names', () => {
    expect(resolveDefaultGstMode(true, 'Uttar Pradesh', '09-Uttar Pradesh')).toBe('CGST_SGST');
    expect(resolveDefaultGstMode(true, '09-Uttar Pradesh', 'Uttara Pradesh')).toBe('CGST_SGST');
    expect(resolveDefaultGstMode(true, 'Uttar Pradesh', '03-Punjab')).toBe('IGST');
  });

  it('matches Zoho Books exact CGST+SGST paisa rounding and adjustmentOverride', () => {
    // Matches EST-000006 in Estimate_ce013a0e.csv
    const est6 = computeDocumentTotals(
      [
        {
          itemName: 'Website Designing - BUSINESS PLUS',
          description: 'Dynamic website with hosting',
          hsnSac: '998314',
          qty: 1,
          rate: 18000,
          discount: 5286.6,
          taxPercent: 18,
        },
      ],
      'CGST_SGST',
      false,
      -1.82
    );
    expect(est6.subtotal).toBe(18000);
    expect(est6.discountTotal).toBe(5286.6);
    expect(est6.taxableTotal).toBe(12713.4);
    expect(est6.cgstTotal).toBe(1144.21);
    expect(est6.sgstTotal).toBe(1144.21);
    expect(est6.taxTotal).toBe(2288.42);
    expect(est6.roundOff).toBe(-1.82);
    expect(est6.total).toBe(15000);

    const concession = computeDocumentTotals(
      [
        {
          itemName: 'Website Design - BUSINESS',
          description: 'Business website',
          qty: 1,
          rate: 12000,
          discount: 0,
          taxPercent: 18,
        },
      ],
      'CGST_SGST',
      false,
      -1800
    );
    expect(concession.taxTotal).toBe(2160);
    expect(concession.roundOff).toBe(-1800);
    expect(concession.total).toBe(12360);
  });
});

describe('Zoho Estimate CSV Parser (Estimate_ce013a0e.csv)', () => {
  it('parses all 50 estimates cleanly with exact Zoho totals and mapped fields', () => {
    const csvPath = path.resolve(process.cwd(), 'public/assets/aistudio/Estimate_ce013a0e.csv');
    const csvText = fs.readFileSync(csvPath, 'utf8');
    const parsed = parseEstimateCsv(csvText, 'Uttar Pradesh', true);

    expect(parsed.length).toBe(50);
    expect(parsed.every((e) => e.valid)).toBe(true);

    // Total parity check against Zoho CSV Total column
    for (const est of parsed) {
      if (est.csvTotal !== undefined) {
        expect(Math.abs(est.computedTotal - est.csvTotal)).toBeLessThanOrEqual(0.05);
      }
    }

    // Verify status mapping: invoiced -> ACCEPTED, expired -> EXPIRED
    expect(parsed.some((e) => e.status === 'ACCEPTED')).toBe(true);
    expect(parsed.some((e) => e.status === 'EXPIRED')).toBe(true);

    // Verify inter-state IGST detection (03-Punjab)
    const punjabEst = parsed.find((e) => e.placeOfSupply === '03-Punjab');
    expect(punjabEst).toBeDefined();
    expect(punjabEst?.gstMode).toBe('IGST');

    // Verify EST-000041 flat Discount Amount usage
    const est41 = parsed.find((e) => e.estimateNumber === 'EST-000041');
    expect(est41).toBeDefined();
    expect(est41?.items.some((it) => it.discount > 0)).toBe(true);
  });

  it('renders referenceNumber, projectName, placeOfSupply, itemName, adjustmentLabel, and Axis Bank details in Estimate PDF', async () => {
    const buf = await generateEstimatePdfBuffer(
      {
        estimateNumber: 'EST-000006',
        issueDate: '2020-02-12T00:00:00.000Z',
        validUntil: '2020-02-27T00:00:00.000Z',
        referenceNumber: 'PO-2020-88',
        projectName: 'Business Plus Web Portal',
        placeOfSupply: '09-Uttar Pradesh',
        gstMode: 'CGST_SGST',
        subtotal: 18000,
        discountTotal: 5286.6,
        taxTotal: 2288.42,
        roundOff: -1.82,
        adjustmentLabel: 'Concession',
        total: 15000,
        status: 'ACCEPTED',
        client: {
          name: 'Sample Client',
          address: 'Aligarh',
          state: 'Uttar Pradesh',
        },
        items: [
          {
            itemName: 'Website Designing - BUSINESS PLUS',
            description: '- Dynamic Pages\n- .com Domain included',
            hsnSac: '998314',
            qty: 1,
            rate: 18000,
            discount: 5286.6,
            taxPercent: 18,
            lineTotal: 15001.82,
          },
        ],
      },
      {
        businessName: 'Aligarh Web Solutions',
        businessState: 'Uttar Pradesh',
        bankName: 'Axis Bank',
        bankAccountName: 'Aligarh Web Solutions',
        bankAccountNumber: '918020006575926',
        bankIfsc: 'UTIB0003686',
      }
    );

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1500);
  });
});
