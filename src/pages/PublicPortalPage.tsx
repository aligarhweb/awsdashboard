import { useEffect, useState } from 'react';
import { Download, CheckCircle2, XCircle, Printer, ExternalLink } from 'lucide-react';
import { formatDateDDMMMYYYY } from '../../shared/dates';
import { formatINR } from '../../shared/currency';
import { amountInWordsINR } from '../../shared/billing';

interface PublicPortalPageProps {
  kind: 'invoice' | 'estimate';
  token: string;
}

export function PublicPortalPage({ kind, token }: PublicPortalPageProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<any | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [responseNotice, setResponseNotice] = useState<string | null>(null);

  async function loadDocument() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/${kind}/${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Document not found');
      setPayload(data);
    } catch (err: any) {
      setError(err.message || 'Unable to load document');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDocument();
  }, [kind, token]);

  async function handleEstimateDecision(decision: 'ACCEPT' | 'REJECT') {
    setSubmitting(true);
    setResponseNotice(null);
    try {
      const res = await fetch(`/api/public/estimate/${encodeURIComponent(token)}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ decision, comment: comment.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not submit response');
      setResponseNotice(
        decision === 'ACCEPT'
          ? 'Thank you! This estimate has been marked as Accepted.'
          : 'Your feedback has been recorded.'
      );
      await loadDocument();
    } catch (err: any) {
      setResponseNotice(err.message || 'Action failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-sm text-slate-500">Loading document...</div>
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-xl border border-slate-200 bg-white p-8 text-center">
          <h1 className="text-lg font-bold text-slate-900">Link Unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{error || 'This link may have expired or been removed.'}</p>
        </div>
      </div>
    );
  }

  const business = payload.business;
  const doc = kind === 'invoice' ? payload.invoice : payload.estimate;
  const docNumber = kind === 'invoice' ? doc.invoiceNumber : doc.estimateNumber;
  const pdfUrl = `/api/public/${kind}/${encodeURIComponent(token)}/pdf`;

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4 print:bg-white print:p-0">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Top Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="text-sm font-semibold text-slate-800">
            {business.businessName} · Client Portal
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Printer className="h-3.5 w-3.5" /> Print
            </button>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700"
            >
              <Download className="h-3.5 w-3.5" /> Download PDF
            </a>
          </div>
        </div>

        {/* Document Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-10 shadow-sm space-y-8 print:border-0 print:shadow-none">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-6 border-b border-slate-200 pb-6">
            <div className="flex items-start gap-4">
              {business.logoDataUrl && (
                <img
                  src={business.logoDataUrl}
                  alt={business.businessName}
                  className="h-14 w-14 object-contain rounded"
                />
              )}
              <div className="space-y-1">
                <h1 className="text-xl font-bold text-slate-900">{business.businessName}</h1>
                {business.address && <p className="text-xs text-slate-600 max-w-sm">{business.address}</p>}
                <p className="text-xs text-slate-500">
                  {[
                    business.gstin ? `GSTIN: ${business.gstin}` : null,
                    business.pan ? `PAN: ${business.pan}` : null,
                    business.businessState ? `State: ${business.businessState}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            </div>

            <div className="text-left sm:text-right space-y-1">
              <p className="text-lg font-bold tracking-tight text-sky-600">
                {kind === 'invoice' ? (doc.gstMode === 'NONE' ? 'INVOICE' : 'TAX INVOICE') : 'ESTIMATE'}
              </p>
              <p className="font-mono text-sm font-bold text-slate-900">{docNumber}</p>
              <p className="text-xs text-slate-600 font-mono">
                Issued: {formatDateDDMMMYYYY(doc.issueDate)} ·{' '}
                {kind === 'invoice'
                  ? `Due: ${formatDateDDMMMYYYY(doc.dueDate)}`
                  : `Valid Until: ${formatDateDDMMMYYYY(doc.validUntil)}`}
              </p>
              <p className="text-xs font-semibold text-slate-800">Status: {doc.status}</p>
            </div>
          </div>

          {/* Bill To */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-500">Bill To</p>
              <p className="text-sm font-bold text-slate-900">{doc.client?.name}</p>
              {doc.client?.company && doc.client.company !== doc.client.name && (
                <p className="text-xs text-slate-700">{doc.client.company}</p>
              )}
              {doc.client?.address && <p className="text-xs text-slate-600">{doc.client.address}</p>}
              <p className="text-xs text-slate-500">
                {[
                  doc.placeOfSupply || doc.client?.state
                    ? `Place of Supply: ${doc.placeOfSupply || doc.client.state}`
                    : null,
                  doc.client?.gstin ? `GSTIN: ${doc.client.gstin}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            {(doc.projectName || doc.referenceNumber) && (
              <div className="space-y-1 text-left sm:text-right text-xs">
                {doc.projectName && (
                  <p className="text-slate-700">
                    <span className="font-semibold text-slate-500">Project:</span> {doc.projectName}
                  </p>
                )}
                {doc.referenceNumber && (
                  <p className="text-slate-700">
                    <span className="font-semibold text-slate-500">Reference #:</span> {doc.referenceNumber}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Line Items */}
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">#</th>
                  <th className="px-3 py-2.5 font-semibold">Item &amp; Description</th>
                  <th className="px-3 py-2.5 font-semibold">HSN/SAC</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Qty</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Rate</th>
                  {doc.gstMode !== 'NONE' && <th className="px-3 py-2.5 font-semibold text-right">GST %</th>}
                  <th className="px-3 py-2.5 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(doc.items || []).map((it: any, i: number) => (
                  <tr key={i} className="align-top">
                    <td className="px-3 py-2.5 font-mono text-slate-500">{i + 1}</td>
                    <td className="px-3 py-2.5 text-slate-900">
                      {it.itemName && it.itemName.trim() !== (it.description || '').trim() && (
                        <div className="font-semibold text-slate-900 mb-0.5">{it.itemName}</div>
                      )}
                      <div className="whitespace-pre-line text-slate-700">{it.description}</div>
                      {Number(it.discount) > 0 && (
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Discount: −{formatINR(it.discount, { decimals: 2 })}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-500">{it.hsnSac || '998314'}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{it.qty}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {formatINR(it.rate, { decimals: 2 })}
                    </td>
                    {doc.gstMode !== 'NONE' && (
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{it.taxPercent}%</td>
                    )}
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {formatINR(it.lineTotal, { decimals: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals & Payment / UPI QR */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-slate-500">Amount in Words</p>
                <p className="mt-1 text-xs font-medium text-slate-800">{amountInWordsINR(doc.total)}</p>
              </div>

              {(business.upiId || business.bankAccountNumber || business.bankName) && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex flex-wrap items-center gap-4">
                  {kind === 'invoice' && doc.upiQrDataUrl && doc.balanceDue > 0 && (
                    <div className="text-center shrink-0">
                      <img
                        src={doc.upiQrDataUrl}
                        alt="UPI Payment QR Code"
                        className="h-28 w-28 rounded border border-slate-200 bg-white p-1"
                      />
                      {doc.upiUri && (
                        <a
                          href={doc.upiUri}
                          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-sky-600 hover:underline"
                        >
                          Pay via UPI App <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  )}
                  <div className="space-y-1 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">Bank &amp; Payment Details</p>
                    {business.upiId && (
                      <p>
                        UPI ID: <span className="font-mono font-semibold">{business.upiId}</span>
                      </p>
                    )}
                    {business.bankName && <p>Bank: {business.bankName}</p>}
                    {business.bankAccountName && <p>A/C Name: {business.bankAccountName}</p>}
                    {business.bankAccountNumber && (
                      <p>
                        A/C No: <span className="font-mono">{business.bankAccountNumber}</span>
                      </p>
                    )}
                    {business.bankIfsc && (
                      <p>
                        IFSC: <span className="font-mono">{business.bankIfsc}</span>
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2 text-xs md:max-w-xs md:ml-auto w-full">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="font-mono tabular-nums">{formatINR(doc.subtotal, { decimals: 2 })}</span>
              </div>
              {Number(doc.discountTotal) > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Discount</span>
                  <span className="font-mono tabular-nums">− {formatINR(doc.discountTotal, { decimals: 2 })}</span>
                </div>
              )}
              {doc.gstMode === 'CGST_SGST' && (
                <>
                  <div className="flex justify-between text-slate-600">
                    <span>CGST</span>
                    <span className="font-mono tabular-nums">
                      {formatINR(kind === 'invoice' ? doc.cgstTotal : doc.taxTotal / 2, { decimals: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>SGST</span>
                    <span className="font-mono tabular-nums">
                      {formatINR(kind === 'invoice' ? doc.sgstTotal : doc.taxTotal / 2, { decimals: 2 })}
                    </span>
                  </div>
                </>
              )}
              {doc.gstMode === 'IGST' && (
                <div className="flex justify-between text-slate-600">
                  <span>IGST</span>
                  <span className="font-mono tabular-nums">
                    {formatINR(kind === 'invoice' ? doc.igstTotal : doc.taxTotal, { decimals: 2 })}
                  </span>
                </div>
              )}
              {Number(doc.roundOff) !== 0 && (
                <div className="flex justify-between text-slate-500">
                  <span>{doc.adjustmentLabel || 'Round Off'}</span>
                  <span className="font-mono tabular-nums">{formatINR(doc.roundOff, { decimals: 2 })}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-bold text-slate-900">
                <span>Grand Total</span>
                <span className="font-mono tabular-nums">{formatINR(doc.total, { decimals: 2 })}</span>
              </div>
              {kind === 'invoice' && (
                <>
                  <div className="flex justify-between text-emerald-700">
                    <span>Amount Paid</span>
                    <span className="font-mono tabular-nums">− {formatINR(doc.amountPaid, { decimals: 2 })}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-bold text-sky-700">
                    <span>Balance Due</span>
                    <span className="font-mono tabular-nums">{formatINR(doc.balanceDue, { decimals: 2 })}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Notes & Terms */}
          {(doc.notes || doc.terms) && (
            <div className="border-t border-slate-200 pt-5 space-y-3 text-xs text-slate-600">
              {doc.notes && (
                <div>
                  <p className="font-semibold text-slate-800">Notes</p>
                  <p className="mt-1 whitespace-pre-line">{doc.notes}</p>
                </div>
              )}
              {doc.terms && (
                <div>
                  <p className="font-semibold text-slate-800">Terms &amp; Conditions</p>
                  <p className="mt-1 whitespace-pre-line">{doc.terms}</p>
                </div>
              )}
            </div>
          )}

          {/* Estimate Approval Controls */}
          {kind === 'estimate' && (
            <div className="border-t border-slate-200 pt-6 space-y-3 print:hidden">
              <h2 className="text-sm font-bold text-slate-900">Client Approval</h2>
              {responseNotice && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-xs font-medium text-sky-800">
                  {responseNotice}
                </div>
              )}
              {doc.respondedAt && (
                <p className="text-xs text-slate-600">
                  Last response: <strong>{doc.status}</strong> on {formatDateDDMMMYYYY(doc.respondedAt)}
                  {doc.clientComment ? ` — "${doc.clientComment}"` : ''}
                </p>
              )}
              {doc.status !== 'ACCEPTED' && (
                <div className="space-y-3">
                  <textarea
                    rows={2}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Optional comment or change request..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-sky-500 focus:outline-none"
                  />
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleEstimateDecision('ACCEPT')}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Approve Estimate
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleEstimateDecision('REJECT')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      <XCircle className="h-4 w-4" /> Request Changes / Decline
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
