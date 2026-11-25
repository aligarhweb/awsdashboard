import { useEffect, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { apiRequest, downloadWithAuth } from '../lib/api';
import { ClientDTO, ReportsSummaryDTO } from '../../shared/types';
import { formatDateDDMMMYYYY, getIstDateParts } from '../../shared/dates';
import { formatINR } from '../../shared/currency';
import { useToast } from '../components/Toast';

interface ReportsPageProps {
  onOpenClient: (clientId: string) => void;
  onOpenInvoice: (invoiceId: string) => void;
}

interface ClientStatementResponse {
  client: { id: string; name: string; company: string | null; gstin: string | null };
  totals: { totalInvoiced: number; totalPaid: number; closingBalance: number };
  entries: Array<{
    date: string;
    type: 'INVOICE' | 'PAYMENT' | 'CREDIT_NOTE';
    reference: string;
    details: string;
    debit: number;
    credit: number;
    runningBalance: number;
  }>;
}

function getDefaultFyRange(): { from: string; to: string } {
  const { year, month } = getIstDateParts(new Date());
  const fyStartYear = month >= 4 ? year : year - 1;
  return {
    from: `${fyStartYear}-04-01`,
    to: `${fyStartYear + 1}-03-31`,
  };
}

function getCurrentMonthRange(): { from: string; to: string } {
  const { year, month } = getIstDateParts(new Date());
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function ReportsPage({ onOpenClient, onOpenInvoice }: ReportsPageProps) {
  const { showToast } = useToast();
  const initialRange = getDefaultFyRange();
  const [fromDate, setFromDate] = useState(initialRange.from);
  const [toDate, setToDate] = useState(initialRange.to);
  const [tab, setTab] = useState<'sales' | 'gst' | 'aging' | 'profit' | 'statement'>('sales');

  const [summary, setSummary] = useState<ReportsSummaryDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const [clients, setClients] = useState<ClientDTO[]>([]);
  const [statementClientId, setStatementClientId] = useState('');
  const [statement, setStatement] = useState<ClientStatementResponse | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);

  async function loadSummary() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: fromDate, to: toDate });
      const res = await apiRequest<ReportsSummaryDTO>(`/api/reports/summary?${params}`);
      setSummary(res);
    } catch (err: any) {
      showToast(err.message || 'Failed to load financial reports', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    apiRequest<{ items: ClientDTO[] }>('/api/clients?pageSize=100')
      .then((res) => {
        setClients(res.items);
        if (res.items[0]) setStatementClientId(res.items[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadSummary();
  }, [fromDate, toDate]);

  useEffect(() => {
    if (tab !== 'statement' || !statementClientId) return;
    setStatementLoading(true);
    apiRequest<ClientStatementResponse>(`/api/reports/client-statement/${statementClientId}`)
      .then(setStatement)
      .catch((err: any) => showToast(err.message || 'Could not load client statement', 'error'))
      .finally(() => setStatementLoading(false));
  }, [tab, statementClientId]);

  const queryRange = new URLSearchParams({ from: fromDate, to: toDate }).toString();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Financial &amp; CA Reports
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Sales register, monthly CGST/SGST/IGST breakup, receivable aging, renewal margin &amp; Zoho Books export
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              downloadWithAuth(`/api/reports/export/sales-csv?${queryRange}`, 'sales-register.csv').catch((e) =>
                showToast(e.message, 'error')
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" /> Sales CSV
          </button>
          <button
            type="button"
            onClick={() =>
              downloadWithAuth(`/api/reports/export/gst-csv?${queryRange}`, 'gst-monthly-summary.csv').catch((e) =>
                showToast(e.message, 'error')
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" /> GST CSV
          </button>
          <button
            type="button"
            onClick={() =>
              downloadWithAuth(`/api/reports/export/zoho-books-csv?${queryRange}`, 'zoho-books-invoices.csv').catch(
                (e) => showToast(e.message, 'error')
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-700 whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> Zoho Books CSV
          </button>
        </div>
      </div>

      {/* Date Range Controls */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-xs">
        <span className="font-medium text-slate-600 dark:text-slate-400">Date Range:</span>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-xs"
        />
        <span className="text-slate-400">to</span>
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-xs"
        />
        <div className="flex items-center gap-1.5 ml-auto">
          <button
            type="button"
            onClick={() => {
              const r = getDefaultFyRange();
              setFromDate(r.from);
              setToDate(r.to);
            }}
            className="rounded border border-slate-200 dark:border-slate-700 px-2.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            This FY
          </button>
          <button
            type="button"
            onClick={() => {
              const r = getCurrentMonthRange();
              setFromDate(r.from);
              setToDate(r.to);
            }}
            className="rounded border border-slate-200 dark:border-slate-700 px-2.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            This Month
          </button>
        </div>
      </div>

      {/* KPI Summary */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Billed</p>
            <p className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatINR(summary.totals.billedTotal, { decimals: 2 })}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 font-mono tabular-nums">
              Taxable: {formatINR(summary.totals.taxableTotal)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total GST Output</p>
            <p className="mt-1 text-xl font-bold font-mono tabular-nums text-sky-600 dark:text-sky-400">
              {formatINR(summary.totals.taxTotal, { decimals: 2 })}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 font-mono tabular-nums">
              CGST+SGST {formatINR(summary.totals.cgstTotal + summary.totals.sgstTotal)} · IGST {formatINR(summary.totals.igstTotal)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Collected / Expenses</p>
            <p className="mt-1 text-xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatINR(summary.totals.collectedTotal, { decimals: 2 })}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 font-mono tabular-nums">
              Expenses: {formatINR(summary.totals.expensesTotal)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Receivable Aging</p>
            <p className="mt-1 text-xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
              {formatINR(summary.totals.outstandingTotal, { decimals: 2 })}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 font-mono tabular-nums">
              90d Renewal Margin: {formatINR(summary.totals.estimatedRenewalProfit90d)}
            </p>
          </div>
        </div>
      )}

      {/* Report Tabs */}
      <div className="inline-flex flex-wrap rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 text-xs gap-1">
        {[
          { key: 'sales', label: 'Sales Register' },
          { key: 'gst', label: 'Monthly GST Summary' },
          { key: 'aging', label: 'Outstanding Aging' },
          { key: 'profit', label: '90-Day Renewal Profit' },
          { key: 'statement', label: 'Client Statement' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key as any)}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors whitespace-nowrap ${
              tab === t.key
                ? 'bg-sky-600 text-white'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Report Body */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {loading && !summary ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
        ) : tab === 'sales' && summary ? (
          summary.salesRegister.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No non-cancelled invoices issued in the selected date range.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Invoice #</th>
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Client / GSTIN</th>
                    <th className="px-4 py-2.5 font-medium">Supply</th>
                    <th className="px-4 py-2.5 font-medium text-right">Taxable</th>
                    <th className="px-4 py-2.5 font-medium text-right">CGST</th>
                    <th className="px-4 py-2.5 font-medium text-right">SGST</th>
                    <th className="px-4 py-2.5 font-medium text-right">IGST</th>
                    <th className="px-4 py-2.5 font-medium text-right">Total</th>
                    <th className="px-4 py-2.5 font-medium text-right">Balance</th>
                    <th className="px-4 py-2.5 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {summary.salesRegister.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-2.5 font-mono font-semibold">
                        <button
                          type="button"
                          onClick={() => onOpenInvoice(r.id)}
                          className="text-sky-600 dark:text-sky-400 hover:underline"
                        >
                          {r.invoiceNumber}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {formatDateDDMMMYYYY(r.issueDate)}
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => onOpenClient(r.clientId)}
                          className="font-medium text-slate-900 dark:text-slate-100 hover:text-sky-600"
                        >
                          {r.clientName}
                        </button>
                        {r.clientGstin && <div className="font-mono text-[11px] text-slate-400">{r.clientGstin}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">{r.placeOfSupply || '—'}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatINR(r.taxableValue, { decimals: 2 })}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatINR(r.cgst, { decimals: 2 })}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatINR(r.sgst, { decimals: 2 })}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatINR(r.igst, { decimals: 2 })}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">{formatINR(r.total, { decimals: 2 })}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-amber-600 dark:text-amber-400">
                        {formatINR(r.balanceDue, { decimals: 2 })}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-medium">{r.status.replace('_', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : tab === 'gst' && summary ? (
          summary.gstMonthly.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">No monthly GST activity in this date range.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Month</th>
                    <th className="px-4 py-2.5 font-medium text-right">Invoices</th>
                    <th className="px-4 py-2.5 font-medium text-right">Taxable Value</th>
                    <th className="px-4 py-2.5 font-medium text-right">CGST</th>
                    <th className="px-4 py-2.5 font-medium text-right">SGST</th>
                    <th className="px-4 py-2.5 font-medium text-right">IGST</th>
                    <th className="px-4 py-2.5 font-medium text-right">Total GST</th>
                    <th className="px-4 py-2.5 font-medium text-right">Gross Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {summary.gstMonthly.map((m) => (
                    <tr key={m.monthKey} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{m.monthLabel}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{m.invoiceCount}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{formatINR(m.taxableValue, { decimals: 2 })}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{formatINR(m.cgst, { decimals: 2 })}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{formatINR(m.sgst, { decimals: 2 })}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{formatINR(m.igst, { decimals: 2 })}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-sky-600 dark:text-sky-400">
                        {formatINR(m.totalTax, { decimals: 2 })}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                        {formatINR(m.invoiceTotal, { decimals: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : tab === 'aging' && summary ? (
          <div className="p-5 space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Not Yet Due', data: summary.agingBuckets.current, tone: 'text-slate-900 dark:text-slate-100' },
                { label: '1–30 Days Overdue', data: summary.agingBuckets.days0to30, tone: 'text-amber-600 dark:text-amber-400' },
                { label: '31–60 Days Overdue', data: summary.agingBuckets.days31to60, tone: 'text-orange-600 dark:text-orange-400' },
                { label: '61+ Days Overdue', data: summary.agingBuckets.days61Plus, tone: 'text-red-600 dark:text-red-400' },
              ].map((b) => (
                <div key={b.label} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                  <p className="text-xs text-slate-500">{b.label}</p>
                  <p className={`mt-1 text-lg font-bold font-mono tabular-nums ${b.tone}`}>
                    {formatINR(b.data.amount, { decimals: 2 })}
                  </p>
                  <p className="text-[11px] font-mono text-slate-400">{b.data.count} invoice(s)</p>
                </div>
              ))}
            </div>
            {summary.agingBuckets.items.length === 0 ? (
              <p className="text-center text-xs text-slate-500 py-4">Zero outstanding invoices.</p>
            ) : (
              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-4 py-2 font-medium">Invoice #</th>
                      <th className="px-4 py-2 font-medium">Client</th>
                      <th className="px-4 py-2 font-medium">Due Date</th>
                      <th className="px-4 py-2 font-medium text-right">Days Overdue</th>
                      <th className="px-4 py-2 font-medium text-right">Bucket</th>
                      <th className="px-4 py-2 font-medium text-right">Balance Due</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {summary.agingBuckets.items.map((it) => (
                      <tr key={it.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2.5 font-mono font-semibold">
                          <button
                            type="button"
                            onClick={() => onOpenInvoice(it.id)}
                            className="text-sky-600 dark:text-sky-400 hover:underline"
                          >
                            {it.invoiceNumber}
                          </button>
                        </td>
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() => onOpenClient(it.clientId)}
                            className="font-medium hover:text-sky-600"
                          >
                            {it.clientName}
                          </button>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-400">
                          {formatDateDDMMMYYYY(it.dueDate)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                          {it.daysOverdue > 0 ? `${it.daysOverdue}d` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono">{it.bucket}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                          {formatINR(it.balanceDue, { decimals: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : tab === 'profit' && summary ? (
          summary.renewalProfitItems.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No domain or service renewals scheduled within the next 90 days.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Domain / Service</th>
                    <th className="px-4 py-2.5 font-medium">Client</th>
                    <th className="px-4 py-2.5 font-medium">Renewal Date</th>
                    <th className="px-4 py-2.5 font-medium text-right">Sell Price</th>
                    <th className="px-4 py-2.5 font-medium text-right">Provider Cost</th>
                    <th className="px-4 py-2.5 font-medium text-right">Est. Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {summary.renewalProfitItems.map((it) => (
                    <tr key={`${it.kind}-${it.id}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-2.5 font-mono text-slate-500">{it.kind}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">{it.name}</td>
                      <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{it.clientName}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-400">
                        {formatDateDDMMMYYYY(it.renewalDate)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatINR(it.sellingPrice)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-500">
                        {formatINR(it.costPrice)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono font-semibold tabular-nums ${
                          it.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {formatINR(it.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Client Ledger:</label>
                <select
                  value={statementClientId}
                  onChange={(e) => setStatementClientId(e.target.value)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs"
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              {statement && (
                <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums">
                  <span>Invoiced: {formatINR(statement.totals.totalInvoiced, { decimals: 2 })}</span>
                  <span className="text-emerald-600 dark:text-emerald-400">
                    Paid/Credits: {formatINR(statement.totals.totalPaid, { decimals: 2 })}
                  </span>
                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                    Closing Balance: {formatINR(statement.totals.closingBalance, { decimals: 2 })}
                  </span>
                </div>
              )}
            </div>

            {statementLoading ? (
              <div className="h-32 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ) : !statement || statement.entries.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">
                No finalized invoices, payments, or credit notes recorded for this client.
              </p>
            ) : (
              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium">Type</th>
                      <th className="px-4 py-2 font-medium">Reference</th>
                      <th className="px-4 py-2 font-medium">Details</th>
                      <th className="px-4 py-2 font-medium text-right">Debit</th>
                      <th className="px-4 py-2 font-medium text-right">Credit</th>
                      <th className="px-4 py-2 font-medium text-right">Running Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {statement.entries.map((e, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {formatDateDDMMMYYYY(e.date)}
                        </td>
                        <td className="px-4 py-2.5 font-mono">{e.type}</td>
                        <td className="px-4 py-2.5 font-mono font-medium text-slate-900 dark:text-slate-100">
                          {e.reference}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">{e.details}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                          {e.debit > 0 ? formatINR(e.debit, { decimals: 2 }) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                          {e.credit > 0 ? formatINR(e.credit, { decimals: 2 }) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">
                          {formatINR(e.runningBalance, { decimals: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
