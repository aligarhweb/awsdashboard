import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Download, Trash2, X, CalendarCheck2, ReceiptText } from 'lucide-react';
import { apiRequest, downloadWithAuth } from '../lib/api';
import {
  ClientDTO,
  CreditNoteDTO,
  ExpenseDTO,
  InvoiceDTO,
  PaymentDTO,
  PaymentMethod,
} from '../../shared/types';
import { formatDateDDMMMYYYY } from '../../shared/dates';
import { formatINR } from '../../shared/currency';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';

interface PaymentsPageProps {
  onOpenClient: (clientId: string) => void;
  onOpenInvoice: (invoiceId: string) => void;
}

const EXPENSE_CATEGORIES = [
  'Domain Registration / Renewal',
  'Web Hosting / Cloud Server',
  'Email Suite / Workspace',
  'SSL / Security / CDN',
  'Software / Plugin License',
  'Payment Gateway Fee',
  'Other Vendor Expense',
];

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PaymentsPage({ onOpenClient, onOpenInvoice }: PaymentsPageProps) {
  const { showToast } = useToast();
  const [tab, setTab] = useState<'payments' | 'credits' | 'expenses'>('payments');

  const [payments, setPayments] = useState<PaymentDTO[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNoteDTO[]>([]);
  const [expenses, setExpenses] = useState<ExpenseDTO[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDTO[]>([]);
  const [clients, setClients] = useState<ClientDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState('');
  const [methodFilter, setMethodFilter] = useState('ALL');

  // Record Payment modal
  const [payOpen, setPayOpen] = useState(false);
  const [payInvoiceId, setPayInvoiceId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(todayIsoDate());
  const [payMethod, setPayMethod] = useState<PaymentMethod>('UPI');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [paySaving, setPaySaving] = useState(false);

  // Linked renewal extension modal
  const [extendCandidates, setExtendCandidates] = useState<
    Array<{ kind: 'DOMAIN' | 'SERVICE'; id: string; name: string; currentDate: string; nextDate: string }>
  >([]);
  const [extending, setExtending] = useState(false);

  // Add Expense modal
  const [expOpen, setExpOpen] = useState(false);
  const [expDate, setExpDate] = useState(todayIsoDate());
  const [expCategory, setExpCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [expVendor, setExpVendor] = useState('Hostinger');
  const [expAmount, setExpAmount] = useState('');
  const [expClientId, setExpClientId] = useState('');
  const [expNotes, setExpNotes] = useState('');
  const [expSaving, setExpSaving] = useState(false);

  // Delete confirms
  const [deletePaymentTarget, setDeletePaymentTarget] = useState<PaymentDTO | null>(null);
  const [deleteExpenseTarget, setDeleteExpenseTarget] = useState<ExpenseDTO | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (methodFilter !== 'ALL') params.set('method', methodFilter);

      const [payRes, expRes, invRes, cliRes] = await Promise.all([
        apiRequest<{ items: PaymentDTO[]; creditNotes: CreditNoteDTO[] }>(`/api/payments?${params}`),
        apiRequest<{ items: ExpenseDTO[] }>('/api/expenses'),
        apiRequest<{ items: InvoiceDTO[] }>('/api/invoices'),
        apiRequest<{ items: ClientDTO[] }>('/api/clients?pageSize=100'),
      ]);
      setPayments(payRes.items);
      setCreditNotes(payRes.creditNotes);
      setExpenses(expRes.items);
      setInvoices(invRes.items);
      setClients(cliRes.items);
    } catch (err: any) {
      showToast(err.message || 'Failed to load payments ledger', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, [q, methodFilter]);

  const unpaidInvoices = useMemo(
    () => invoices.filter((inv) => inv.status !== 'PAID' && inv.status !== 'CANCELLED' && inv.balanceDue > 0.01),
    [invoices]
  );

  function openRecordPaymentModal() {
    const first = unpaidInvoices[0];
    setPayInvoiceId(first?.id || '');
    setPayAmount(first ? String(first.balanceDue) : '');
    setPayDate(todayIsoDate());
    setPayMethod('UPI');
    setPayRef('');
    setPayNotes('');
    setPayOpen(true);
  }

  function handleSelectInvoice(id: string) {
    setPayInvoiceId(id);
    const inv = unpaidInvoices.find((i) => i.id === id);
    if (inv) {
      setPayAmount(String(inv.balanceDue));
    }
  }

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payInvoiceId) {
      showToast('Select an unpaid invoice first', 'error');
      return;
    }
    const amt = Number(payAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast('Enter a valid payment amount', 'error');
      return;
    }

    setPaySaving(true);
    try {
      const res = await apiRequest<{
        payment: PaymentDTO;
        invoiceStatus: string;
        linkedRenewals: Array<{
          kind: 'DOMAIN' | 'SERVICE';
          id: string;
          name: string;
          currentDate: string;
          nextDate: string;
        }>;
      }>('/api/payments', {
        method: 'POST',
        body: JSON.stringify({
          invoiceId: payInvoiceId,
          paidAt: payDate,
          amount: amt,
          method: payMethod,
          referenceUtr: payRef.trim() || null,
          notes: payNotes.trim() || null,
        }),
      });
      setPayOpen(false);
      showToast(`Recorded ${res.payment.receiptNumber}`, 'success');
      if (res.linkedRenewals && res.linkedRenewals.length > 0) {
        setExtendCandidates(res.linkedRenewals);
      }
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Could not record payment', 'error');
    } finally {
      setPaySaving(false);
    }
  }

  async function handleExtendRenewals() {
    if (extendCandidates.length === 0) return;
    setExtending(true);
    try {
      const res = await apiRequest<{ updatedCount: number }>('/api/payments/extend-linked', {
        method: 'POST',
        body: JSON.stringify({
          items: extendCandidates.map((c) => ({ kind: c.kind, id: c.id, nextDate: c.nextDate })),
        }),
      });
      showToast(`Extended renewal dates for ${res.updatedCount} linked item(s)`, 'success');
      setExtendCandidates([]);
    } catch (err: any) {
      showToast(err.message || 'Could not extend renewal dates', 'error');
    } finally {
      setExtending(false);
    }
  }

  async function handleCreateExpense(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(expAmount);
    if (!expVendor.trim() || !Number.isFinite(amt) || amt <= 0) {
      showToast('Vendor and positive amount are required', 'error');
      return;
    }
    setExpSaving(true);
    try {
      await apiRequest('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          date: expDate,
          category: expCategory,
          vendor: expVendor.trim(),
          amount: amt,
          clientId: expClientId || null,
          notes: expNotes.trim() || null,
        }),
      });
      setExpOpen(false);
      setExpAmount('');
      setExpNotes('');
      showToast('Vendor expense recorded', 'success');
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Could not log expense', 'error');
    } finally {
      setExpSaving(false);
    }
  }

  async function confirmDeletePayment() {
    if (!deletePaymentTarget) return;
    setDeleting(true);
    try {
      await apiRequest(`/api/payments/${deletePaymentTarget.id}`, { method: 'DELETE' });
      showToast(`Deleted receipt ${deletePaymentTarget.receiptNumber}`, 'success');
      setDeletePaymentTarget(null);
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  }

  async function confirmDeleteExpense() {
    if (!deleteExpenseTarget) return;
    setDeleting(true);
    try {
      await apiRequest(`/api/expenses/${deleteExpenseTarget.id}`, { method: 'DELETE' });
      showToast('Deleted expense entry', 'success');
      setDeleteExpenseTarget(null);
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  }

  const totalCollected = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const totalCredits = creditNotes.reduce((s, c) => s + Number(c.amount || 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Payments, Credits &amp; Expenses
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Track UPI/bank receipts, issue receipt PDFs, credit notes, and registrar/hosting vendor payouts
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setExpDate(todayIsoDate());
              setExpOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" /> Log Expense
          </button>
          <button
            type="button"
            onClick={openRecordPaymentModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700 whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" /> Record Payment
          </button>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Payments Collected</p>
          <p className="mt-1 text-xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            {formatINR(totalCollected, { decimals: 2 })}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 font-mono tabular-nums">{payments.length} receipts</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Credit Notes Issued</p>
          <p className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {formatINR(totalCredits, { decimals: 2 })}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 font-mono tabular-nums">{creditNotes.length} notes</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Vendor Expenses</p>
          <p className="mt-1 text-xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
            {formatINR(totalExpenses, { decimals: 2 })}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 font-mono tabular-nums">{expenses.length} entries</p>
        </div>
      </div>

      {/* Tabs + Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 text-xs">
          {[
            { key: 'payments', label: `Payments (${payments.length})` },
            { key: 'credits', label: `Credit Notes (${creditNotes.length})` },
            { key: 'expenses', label: `Expenses (${expenses.length})` },
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

        {tab === 'payments' && (
          <div className="flex flex-wrap items-center gap-2.5 flex-1 justify-end max-w-xl">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search receipt #, invoice #, UTR, client..."
                className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200"
            >
              <option value="ALL">All Methods</option>
              <option value="UPI">UPI</option>
              <option value="BANK">Bank Transfer / NEFT</option>
              <option value="CASH">Cash</option>
              <option value="RAZORPAY">Razorpay</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
        )}
      </div>

      {/* Table Content */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
        ) : tab === 'payments' ? (
          payments.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">No payments recorded yet</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Record full or partial UPI, bank, or cash payments against any invoice to generate a receipt PDF.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Receipt #</th>
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Client</th>
                    <th className="px-4 py-2.5 font-medium">Invoice #</th>
                    <th className="px-4 py-2.5 font-medium">Method / UTR</th>
                    <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                    <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {payments.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {p.receiptNumber}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {formatDateDDMMMYYYY(p.paidAt)}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <button
                          type="button"
                          onClick={() => onOpenClient(p.clientId)}
                          className="font-medium text-slate-800 dark:text-slate-200 hover:text-sky-600 dark:hover:text-sky-400"
                        >
                          {p.client?.name || '—'}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {p.invoice ? (
                          <button
                            type="button"
                            onClick={() => onOpenInvoice(p.invoiceId)}
                            className="text-sky-600 dark:text-sky-400 hover:underline"
                          >
                            {p.invoice.invoiceNumber}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                        <span className="font-medium text-slate-800 dark:text-slate-200">{p.method}</span>
                        {p.referenceUtr && <span className="ml-2 font-mono text-[11px] text-slate-500">{p.referenceUtr}</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {formatINR(p.amount, { decimals: 2 })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              downloadWithAuth(`/api/payments/${p.id}/pdf`, `${p.receiptNumber}.pdf`).catch((e) =>
                                showToast(e.message, 'error')
                              )
                            }
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-sky-600"
                            title="Download Receipt PDF"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletePaymentTarget(p)}
                            className="rounded p-1.5 text-slate-500 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600"
                            title="Delete payment"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : tab === 'credits' ? (
          creditNotes.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No credit notes issued. Issue credit notes from the Invoices page inspector when adjusting or crediting a billed invoice.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Credit Note #</th>
                    <th className="px-4 py-2.5 font-medium">Issued</th>
                    <th className="px-4 py-2.5 font-medium">Client</th>
                    <th className="px-4 py-2.5 font-medium">Against Invoice</th>
                    <th className="px-4 py-2.5 font-medium">Reason</th>
                    <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {creditNotes.map((cn) => (
                    <tr key={cn.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {cn.creditNoteNumber}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                        {formatDateDDMMMYYYY(cn.issuedAt)}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <button
                          type="button"
                          onClick={() => onOpenClient(cn.clientId)}
                          className="font-medium text-slate-800 dark:text-slate-200 hover:text-sky-600"
                        >
                          {cn.client?.name || '—'}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        <button
                          type="button"
                          onClick={() => onOpenInvoice(cn.invoiceId)}
                          className="text-sky-600 dark:text-sky-400 hover:underline"
                        >
                          {cn.invoice?.invoiceNumber || '—'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">{cn.reason || '—'}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {formatINR(cn.amount, { decimals: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : expenses.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
            No vendor expenses logged yet. Log registrar renewals, Hostinger server invoices, or software payouts to track net margin.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="px-4 py-2.5 font-medium">Vendor</th>
                  <th className="px-4 py-2.5 font-medium">Linked Client</th>
                  <th className="px-4 py-2.5 font-medium">Notes</th>
                  <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                  <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {expenses.map((ex) => (
                  <tr key={ex.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {formatDateDDMMMYYYY(ex.date)}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-slate-900 dark:text-slate-100">{ex.category}</td>
                    <td className="px-4 py-3 text-xs text-slate-700 dark:text-slate-300">{ex.vendor}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                      {ex.client ? (
                        <button
                          type="button"
                          onClick={() => onOpenClient(ex.client!.id)}
                          className="text-sky-600 dark:text-sky-400 hover:underline"
                        >
                          {ex.client.name}
                        </button>
                      ) : (
                        'Overhead / General'
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 max-w-xs truncate">
                      {ex.notes || '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                      {formatINR(ex.amount, { decimals: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setDeleteExpenseTarget(ex)}
                        className="rounded p-1.5 text-slate-500 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600"
                        title="Delete expense"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record Payment Modal */}
      {payOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
              <div className="flex items-center gap-2">
                <ReceiptText className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Record Payment</h2>
              </div>
              <button
                type="button"
                onClick={() => setPayOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleRecordPayment} className="p-5 space-y-4">
              {unpaidInvoices.length === 0 ? (
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  All active invoices are fully paid! Create a new invoice first before recording a payment.
                </p>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Invoice *
                    </label>
                    <select
                      required
                      value={payInvoiceId}
                      onChange={(e) => handleSelectInvoice(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    >
                      {unpaidInvoices.map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.invoiceNumber} — {inv.client?.name} (Due {formatINR(inv.balanceDue, { decimals: 2 })})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Amount (₹) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Payment Date *
                      </label>
                      <input
                        type="date"
                        required
                        value={payDate}
                        onChange={(e) => setPayDate(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Method
                      </label>
                      <select
                        value={payMethod}
                        onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                      >
                        <option value="UPI">UPI</option>
                        <option value="BANK">Bank Transfer / NEFT</option>
                        <option value="CASH">Cash</option>
                        <option value="RAZORPAY">Razorpay</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        UTR / Ref #
                      </label>
                      <input
                        type="text"
                        value={payRef}
                        onChange={(e) => setPayRef(e.target.value)}
                        placeholder="432910884122"
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Notes
                    </label>
                    <input
                      type="text"
                      value={payNotes}
                      onChange={(e) => setPayNotes(e.target.value)}
                      placeholder="Received via Google Pay / HDFC NEFT"
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    />
                  </div>
                </>
              )}
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setPayOpen(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-medium"
                >
                  Cancel
                </button>
                {unpaidInvoices.length > 0 && (
                  <button
                    type="submit"
                    disabled={paySaving}
                    className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                  >
                    {paySaving ? 'Saving...' : 'Save & Generate Receipt'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Linked Renewal Extension Prompt */}
      {extendCandidates.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <CalendarCheck2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Extend Linked Renewal Dates?
                </h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  This invoice is now paid in full. Advance the expiry/renewal date for the linked assets below:
                </p>
              </div>
            </div>
            <div className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-xs">
              {extendCandidates.map((c) => (
                <div key={`${c.kind}-${c.id}`} className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-800 dark:text-slate-200 truncate">{c.name}</span>
                  <span className="font-mono text-slate-500 shrink-0">
                    {formatDateDDMMMYYYY(c.currentDate)} →{' '}
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                      {formatDateDDMMMYYYY(c.nextDate)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setExtendCandidates([])}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-medium"
              >
                Skip
              </button>
              <button
                type="button"
                disabled={extending}
                onClick={handleExtendRenewals}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {extending ? 'Updating...' : 'Extend Renewal Dates'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Vendor Expense Modal */}
      {expOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Log Vendor Expense</h2>
              <button
                type="button"
                onClick={() => setExpOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateExpense} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Amount (₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={expAmount}
                    onChange={(e) => setExpAmount(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Category *
                </label>
                <select
                  value={expCategory}
                  onChange={(e) => setExpCategory(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Vendor *
                </label>
                <input
                  type="text"
                  required
                  value={expVendor}
                  onChange={(e) => setExpVendor(e.target.value)}
                  placeholder="Hostinger / GoDaddy / Cloudflare / Spaceship"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Attributed Client (Optional)
                </label>
                <select
                  value={expClientId}
                  onChange={(e) => setExpClientId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="">General Overhead</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Notes
                </label>
                <input
                  type="text"
                  value={expNotes}
                  onChange={(e) => setExpNotes(e.target.value)}
                  placeholder="Order ID / Domain / Server plan reference"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setExpOpen(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={expSaving}
                  className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {expSaving ? 'Saving...' : 'Save Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deletePaymentTarget)}
        title="Delete Payment Receipt"
        message={`Delete receipt ${deletePaymentTarget?.receiptNumber}? The linked invoice balance will be recalculated automatically.`}
        confirmLabel="Delete Payment"
        loading={deleting}
        onConfirm={confirmDeletePayment}
        onCancel={() => setDeletePaymentTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteExpenseTarget)}
        title="Delete Expense"
        message={`Delete expense entry "${deleteExpenseTarget?.vendor} — ${formatINR(deleteExpenseTarget?.amount || 0)}"?`}
        confirmLabel="Delete Expense"
        loading={deleting}
        onConfirm={confirmDeleteExpense}
        onCancel={() => setDeleteExpenseTarget(null)}
      />
    </div>
  );
}
