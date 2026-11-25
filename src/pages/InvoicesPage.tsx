import React, { useEffect, useState } from 'react';
import {
  Plus,
  Search,
  Download,
  Copy,
  Edit2,
  Trash2,
  X,
  CreditCard,
  ExternalLink,
  Send,
  FilePlus2,
  Eye,
  ReceiptText,
  Mail,
  RefreshCw,
} from 'lucide-react';
import { apiRequest, downloadWithAuth } from '../lib/api';
import {
  BillingCycle,
  CatalogItemDTO,
  ClientDTO,
  DomainDTO,
  GstMode,
  InvoiceDTO,
  InvoiceStatus,
  PaymentMethod,
  ServiceDTO,
  SettingsDTO,
} from '../../shared/types';
import { BillingLineInput, formatPlaceOfSupply, resolveDefaultGstMode } from '../../shared/billing';
import { formatDateDDMMMYYYY } from '../../shared/dates';
import { formatINR } from '../../shared/currency';
import { DocumentLineItemsEditor } from '../components/DocumentLineItemsEditor';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';

interface InvoicesPageProps {
  initialInvoiceId?: string;
  onOpenClient: (clientId: string) => void;
  openCreateTrigger?: number;
}

const STATUS_STYLE: Record<InvoiceStatus, string> = {
  DRAFT: 'text-slate-600 dark:text-slate-400',
  SENT: 'text-sky-600 dark:text-sky-400',
  VIEWED: 'text-indigo-600 dark:text-indigo-400',
  PARTIALLY_PAID: 'text-amber-600 dark:text-amber-400',
  PAID: 'text-emerald-600 dark:text-emerald-400',
  OVERDUE: 'text-red-600 dark:text-red-400',
  CANCELLED: 'text-slate-400 line-through',
};

function todayIsoDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export function InvoicesPage({ initialInvoiceId, onOpenClient, openCreateTrigger }: InvoicesPageProps) {
  const { showToast } = useToast();
  const [invoices, setInvoices] = useState<InvoiceDTO[]>([]);
  const [clients, setClients] = useState<ClientDTO[]>([]);
  const [domains, setDomains] = useState<DomainDTO[]>([]);
  const [services, setServices] = useState<ServiceDTO[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItemDTO[]>([]);
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [fyFilter, setFyFilter] = useState('ALL');

  // Detail inspector
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDTO | null>(null);

  // Create / Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<InvoiceDTO | null>(null);
  const [clientId, setClientId] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [projectName, setProjectName] = useState('');
  const [placeOfSupply, setPlaceOfSupply] = useState('');
  const [issueDate, setIssueDate] = useState(todayIsoDate(0));
  const [dueDate, setDueDate] = useState(todayIsoDate(7));
  const [gstMode, setGstMode] = useState<GstMode>('CGST_SGST');
  const [applyRoundOff, setApplyRoundOff] = useState(true);
  const [adjustmentOverride, setAdjustmentOverride] = useState<number | null>(null);
  const [adjustmentLabel, setAdjustmentLabel] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [recurringCycle, setRecurringCycle] = useState<BillingCycle>('YEARLY');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [items, setItems] = useState<BillingLineInput[]>([
    { itemName: '', description: '', hsnSac: '998314', qty: 1, rate: 0, discount: 0, taxPercent: 18 },
  ]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Record Payment modal
  const [payTarget, setPayTarget] = useState<InvoiceDTO | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(todayIsoDate(0));
  const [payMethod, setPayMethod] = useState<PaymentMethod>('UPI');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [paySaving, setPaySaving] = useState(false);

  // Extend linked renewals prompt after invoice becomes PAID
  const [extendCandidates, setExtendCandidates] = useState<
    Array<{ kind: 'DOMAIN' | 'SERVICE'; id: string; name: string; currentDate: string; nextDate: string }>
  >([]);

  // Credit Note modal
  const [cnTarget, setCnTarget] = useState<InvoiceDTO | null>(null);
  const [cnAmount, setCnAmount] = useState('');
  const [cnReason, setCnReason] = useState('');
  const [cnSaving, setCnSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<InvoiceDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [runningRecurring, setRunningRecurring] = useState(false);

  async function loadMeta() {
    try {
      const [cRes, dRes, sRes, catRes, setRes] = await Promise.all([
        apiRequest<{ items: ClientDTO[] }>('/api/clients?pageSize=100'),
        apiRequest<{ items: DomainDTO[] }>('/api/domains?pageSize=200'),
        apiRequest<{ items: ServiceDTO[] }>('/api/services?pageSize=200'),
        apiRequest<{ items: CatalogItemDTO[] }>('/api/catalog'),
        apiRequest<{ settings: SettingsDTO }>('/api/settings'),
      ]);
      setClients(cRes.items);
      setDomains(dRes.items);
      setServices(sRes.items);
      setCatalogItems(catRes.items);
      setSettings(setRes.settings);
    } catch {
      // handled on main load
    }
  }

  async function loadInvoices() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q, status: statusFilter, fy: fyFilter });
      const res = await apiRequest<{ items: InvoiceDTO[] }>(`/api/invoices?${params}`);
      setInvoices(res.items);
    } catch (err: any) {
      showToast(err.message || 'Failed to load invoices', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function openInspector(id: string) {
    try {
      const res = await apiRequest<{ invoice: InvoiceDTO }>(`/api/invoices/${id}`);
      setSelectedInvoice(res.invoice);
    } catch (err: any) {
      showToast(err.message || 'Could not load invoice details', 'error');
    }
  }

  useEffect(() => {
    loadMeta();
  }, []);

  useEffect(() => {
    loadInvoices();
  }, [q, statusFilter, fyFilter]);

  useEffect(() => {
    if (initialInvoiceId) {
      openInspector(initialInvoiceId);
    }
  }, [initialInvoiceId]);

  useEffect(() => {
    if (openCreateTrigger && openCreateTrigger > 0) {
      openCreate();
    }
  }, [openCreateTrigger]);

  function openCreate() {
    const firstClient = clients[0];
    setEditing(null);
    setClientId(firstClient?.id || '');
    setReferenceNumber('');
    setProjectName('');
    setPlaceOfSupply(formatPlaceOfSupply(firstClient?.state) || '');
    setIssueDate(todayIsoDate(0));
    setDueDate(todayIsoDate(7));
    setGstMode(
      resolveDefaultGstMode(
        Boolean(settings?.gstEnabled ?? true),
        settings?.businessState,
        firstClient?.state
      )
    );
    setApplyRoundOff(true);
    setAdjustmentOverride(null);
    setAdjustmentLabel('');
    setRecurring(false);
    setRecurringCycle('YEARLY');
    setNotes('');
    setTerms(settings?.defaultInvoiceTerms || '');
    setItems([
      {
        itemName: '',
        description: '',
        hsnSac: '998314',
        qty: 1,
        rate: 0,
        discount: 0,
        taxPercent: settings?.defaultTaxRate ?? 18,
      },
    ]);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(inv: InvoiceDTO) {
    setEditing(inv);
    setClientId(inv.clientId);
    setReferenceNumber(inv.referenceNumber || '');
    setProjectName(inv.projectName || '');
    setPlaceOfSupply(inv.placeOfSupply || formatPlaceOfSupply(inv.client?.state) || '');
    setIssueDate(inv.issueDate.slice(0, 10));
    setDueDate(inv.dueDate.slice(0, 10));
    setGstMode(inv.gstMode);
    const hasCustom = Boolean(inv.adjustmentLabel) || Math.abs(inv.roundOff) > 1;
    setApplyRoundOff(inv.roundOff !== 0);
    setAdjustmentOverride(hasCustom ? inv.roundOff : null);
    setAdjustmentLabel(inv.adjustmentLabel || '');
    setRecurring(inv.recurring);
    setRecurringCycle(inv.recurringCycle || 'YEARLY');
    setNotes(inv.notes || '');
    setTerms(inv.terms || '');
    setItems(
      inv.items.map((it) => ({
        itemName: it.itemName || '',
        description: it.description,
        hsnSac: it.hsnSac,
        qty: it.qty,
        rate: it.rate,
        discount: it.discount,
        taxPercent: it.taxPercent,
        domainId: it.domainId || null,
        serviceId: it.serviceId || null,
      }))
    );
    setFormError(null);
    setModalOpen(true);
  }

  function handleClientChange(nextClientId: string) {
    setClientId(nextClientId);
    if (!editing) {
      const c = clients.find((x) => x.id === nextClientId);
      setPlaceOfSupply(formatPlaceOfSupply(c?.state) || '');
      setGstMode(
        resolveDefaultGstMode(Boolean(settings?.gstEnabled ?? true), settings?.businessState, c?.state)
      );
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!clientId) {
      setFormError('Select a client');
      return;
    }
    if (items.some((it) => !it.description.trim())) {
      setFormError('All line items require a description');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        clientId,
        referenceNumber: referenceNumber.trim() || null,
        projectName: projectName.trim() || null,
        placeOfSupply: placeOfSupply.trim() || null,
        issueDate,
        dueDate,
        gstMode,
        applyRoundOff,
        adjustmentOverride,
        adjustmentLabel: adjustmentLabel.trim() || null,
        recurring,
        recurringCycle: recurring ? recurringCycle : null,
        notes: notes.trim() || null,
        terms: terms.trim() || null,
        items,
      };
      if (editing) {
        const res = await apiRequest<{ invoice: InvoiceDTO }>(`/api/invoices/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToast(`Updated ${editing.invoiceNumber}`, 'success');
        if (selectedInvoice?.id === editing.id) setSelectedInvoice(res.invoice);
      } else {
        const res = await apiRequest<{ invoice: InvoiceDTO }>('/api/invoices', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast(`Created ${res.invoice.invoiceNumber}`, 'success');
        setSelectedInvoice(res.invoice);
      }
      setModalOpen(false);
      loadInvoices();
    } catch (err: any) {
      setFormError(err.message || 'Could not save invoice');
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(inv: InvoiceDTO, status: InvoiceStatus) {
    try {
      const res = await apiRequest<{ invoice: InvoiceDTO }>(`/api/invoices/${inv.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      showToast(`${inv.invoiceNumber} marked ${status}`, 'success');
      if (selectedInvoice?.id === inv.id) setSelectedInvoice(res.invoice);
      loadInvoices();
    } catch (err: any) {
      showToast(err.message || 'Status update failed', 'error');
    }
  }

  async function handleEmailInvoice(inv: InvoiceDTO) {
    try {
      const res = await apiRequest<{ invoice: InvoiceDTO; dryRun?: boolean }>(`/api/invoices/${inv.id}/send`, {
        method: 'POST',
        body: JSON.stringify({ channel: 'EMAIL' }),
      });
      showToast(
        res.dryRun ? `Dry-run email logged for ${inv.invoiceNumber}` : `Emailed ${inv.invoiceNumber} PDF to client`,
        'success'
      );
      if (selectedInvoice?.id === inv.id && res.invoice) setSelectedInvoice(res.invoice);
      loadInvoices();
    } catch (err: any) {
      showToast(err.message || 'Failed to email invoice', 'error');
    }
  }

  async function handleDuplicate(inv: InvoiceDTO) {
    try {
      const res = await apiRequest<{ invoice: InvoiceDTO }>(`/api/invoices/${inv.id}/duplicate`, {
        method: 'POST',
      });
      showToast(`Duplicated as ${res.invoice.invoiceNumber}`, 'success');
      loadInvoices();
      setSelectedInvoice(res.invoice);
    } catch (err: any) {
      showToast(err.message || 'Duplicate failed', 'error');
    }
  }

  function openPaymentModal(inv: InvoiceDTO) {
    setPayTarget(inv);
    setPayAmount(String(inv.balanceDue > 0 ? inv.balanceDue : inv.total));
    setPayDate(todayIsoDate(0));
    setPayMethod('UPI');
    setPayRef('');
    setPayNotes('');
  }

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payTarget) return;
    setPaySaving(true);
    try {
      const res = await apiRequest<{
        payment: { receiptNumber: string };
        linkedRenewals: Array<{ kind: 'DOMAIN' | 'SERVICE'; id: string; name: string; currentDate: string; nextDate: string }>;
      }>('/api/payments', {
        method: 'POST',
        body: JSON.stringify({
          invoiceId: payTarget.id,
          paidAt: payDate,
          amount: Number(payAmount),
          method: payMethod,
          referenceUtr: payRef.trim() || null,
          notes: payNotes.trim() || null,
        }),
      });
      showToast(`Payment ${res.payment.receiptNumber} recorded`, 'success');
      const targetId = payTarget.id;
      setPayTarget(null);
      if (res.linkedRenewals && res.linkedRenewals.length > 0) {
        setExtendCandidates(res.linkedRenewals);
      }
      await loadInvoices();
      if (selectedInvoice?.id === targetId) {
        await openInspector(targetId);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to record payment', 'error');
    } finally {
      setPaySaving(false);
    }
  }

  async function handleExtendLinkedRenewals() {
    try {
      await apiRequest('/api/payments/extend-linked', {
        method: 'POST',
        body: JSON.stringify({
          items: extendCandidates.map((c) => ({ kind: c.kind, id: c.id, nextDate: c.nextDate })),
        }),
      });
      showToast(`Extended expiry date for ${extendCandidates.length} linked renewal(s)`, 'success');
      setExtendCandidates([]);
    } catch (err: any) {
      showToast(err.message || 'Could not extend expiry dates', 'error');
    }
  }

  async function handleIssueCreditNote(e: React.FormEvent) {
    e.preventDefault();
    if (!cnTarget) return;
    setCnSaving(true);
    try {
      const res = await apiRequest<{ creditNote: { creditNoteNumber: string } }>(
        `/api/invoices/${cnTarget.id}/credit-note`,
        {
          method: 'POST',
          body: JSON.stringify({
            amount: Number(cnAmount),
            reason: cnReason.trim() || null,
          }),
        }
      );
      showToast(`Credit Note ${res.creditNote.creditNoteNumber} issued`, 'success');
      const id = cnTarget.id;
      setCnTarget(null);
      await loadInvoices();
      if (selectedInvoice?.id === id) await openInspector(id);
    } catch (err: any) {
      showToast(err.message || 'Could not issue credit note', 'error');
    } finally {
      setCnSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(`/api/invoices/${deleteTarget.id}`, { method: 'DELETE' });
      showToast(`Deleted ${deleteTarget.invoiceNumber}`, 'success');
      if (selectedInvoice?.id === deleteTarget.id) setSelectedInvoice(null);
      setDeleteTarget(null);
      loadInvoices();
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  }

  function copyPublicLink(token: string) {
    const url = `${window.location.origin}/public/invoice/${token}`;
    navigator.clipboard.writeText(url);
    showToast('Public invoice link copied', 'success');
  }

  const clientDomains = domains.filter((d) => d.clientId === clientId);
  const clientServices = services.filter((s) => s.clientId === clientId);
  const fyOptions = Array.from(new Set(invoices.map((i) => i.financialYear))).sort().reverse();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Invoices</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            GST tax invoices with Indian FY numbering, pure-JS PDF export, live UPI QR codes, and public links
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={runningRecurring}
            onClick={async () => {
              setRunningRecurring(true);
              try {
                const res = await apiRequest<{ summary: string }>('/api/invoices/run-recurring', { method: 'POST' });
                showToast(res.summary, 'success');
                loadInvoices();
              } catch (err: any) {
                showToast(err.message || 'Could not process recurring invoices', 'error');
              } finally {
                setRunningRecurring(false);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${runningRecurring ? 'animate-spin' : ''}`} />
            Run Recurring Due
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" /> New Invoice
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search invoice #, client, or line item..."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <select
          value={fyFilter}
          onChange={(e) => setFyFilter(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-200"
        >
          <option value="ALL">All FYs</option>
          {fyOptions.map((fy) => (
            <option key={fy} value={fy}>
              FY {fy}
            </option>
          ))}
        </select>

        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1">
          {(['ALL', 'DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {st === 'ALL' ? 'All' : st.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Main Split: Table + Optional Inspector */}
      <div className={`grid gap-5 ${selectedInvoice ? 'grid-cols-1 xl:grid-cols-3' : 'grid-cols-1'}`}>
        <div
          className={`${
            selectedInvoice ? 'xl:col-span-2' : ''
          } rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden`}
        >
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
              ))}
            </div>
          ) : invoices.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">No invoices found</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Create a new invoice or generate one directly from an expiring domain or hosting service.
              </p>
              <button
                type="button"
                onClick={openCreate}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700"
              >
                <Plus className="h-3.5 w-3.5" /> Create First Invoice
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-3 font-medium">Invoice #</th>
                    <th className="px-4 py-3 font-medium">Client</th>
                    <th className="px-4 py-3 font-medium">Issue / Due</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Total</th>
                    <th className="px-4 py-3 font-medium text-right">Balance</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {invoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
                        selectedInvoice?.id === inv.id ? 'bg-sky-50/50 dark:bg-sky-950/20' : ''
                      }`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openInspector(inv.id)}
                          className="font-mono text-xs font-semibold text-sky-700 dark:text-sky-400 hover:underline"
                        >
                          {inv.invoiceNumber}
                        </button>
                        {inv.recurring && (
                          <div className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400">
                            Recurring ({inv.recurringCycle}){inv.nextRecurringAt ? ` · Next ${formatDateDDMMMYYYY(inv.nextRecurringAt)}` : ''}
                          </div>
                        )}
                        {inv.viewedAt && (
                          <div className="text-[11px] text-slate-400">Viewed by client</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => onOpenClient(inv.clientId)}
                          className="font-medium text-slate-900 dark:text-slate-100 hover:text-sky-600 dark:hover:text-sky-400 text-left"
                        >
                          {inv.client?.name || 'Client'}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
                        <div>{formatDateDDMMMYYYY(inv.issueDate)}</div>
                        <div className="text-[11px] text-slate-400">Due {formatDateDDMMMYYYY(inv.dueDate)}</div>
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold whitespace-nowrap">
                        <span className={STATUS_STYLE[inv.status]}>{inv.status.replace('_', ' ')}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-medium text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                        {formatINR(inv.total, { decimals: 2 })}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold tabular-nums whitespace-nowrap">
                        <span className={inv.balanceDue > 0 ? 'text-sky-700 dark:text-sky-400' : 'text-emerald-600 dark:text-emerald-400'}>
                          {formatINR(inv.balanceDue, { decimals: 2 })}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openInspector(inv.id)}
                            title="Inspect & UPI QR"
                            className="rounded p-1.5 text-slate-500 hover:text-sky-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          {inv.balanceDue > 0 && inv.status !== 'CANCELLED' && (
                            <button
                              type="button"
                              onClick={() => openPaymentModal(inv)}
                              title="Record Payment"
                              className="rounded p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50"
                            >
                              <CreditCard className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              downloadWithAuth(`/api/invoices/${inv.id}/pdf`, `${inv.invoiceNumber}.pdf`).catch((e) =>
                                showToast(e.message, 'error')
                              )
                            }
                            title="Download PDF"
                            className="rounded p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => copyPublicLink(inv.publicToken)}
                            title="Copy Public Link"
                            className="rounded p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(inv)}
                            title="Edit Invoice"
                            className="rounded p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(inv)}
                            title="Delete Invoice"
                            className="rounded p-1.5 text-slate-500 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Invoice Detail Inspector */}
        {selectedInvoice && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 h-fit">
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <p className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                  {selectedInvoice.invoiceNumber}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedInvoice.client?.name} · {selectedInvoice.status.replace('_', ' ')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-slate-500">Grand Total</span>
                <p className="font-mono text-base font-bold tabular-nums">
                  {formatINR(selectedInvoice.total, { decimals: 2 })}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Balance Due</span>
                <p className="font-mono text-base font-bold text-sky-600 dark:text-sky-400 tabular-nums">
                  {formatINR(selectedInvoice.balanceDue, { decimals: 2 })}
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2">
              {selectedInvoice.balanceDue > 0 && selectedInvoice.status !== 'CANCELLED' && (
                <button
                  type="button"
                  onClick={() => openPaymentModal(selectedInvoice)}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  <CreditCard className="h-3.5 w-3.5" /> Record Payment
                </button>
              )}
              {selectedInvoice.status === 'DRAFT' && (
                <button
                  type="button"
                  onClick={() => handleStatusChange(selectedInvoice, 'SENT')}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium"
                >
                  <Send className="h-3.5 w-3.5" /> Mark Sent
                </button>
              )}
              <button
                type="button"
                onClick={() => handleEmailInvoice(selectedInvoice)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium hover:border-sky-500 hover:text-sky-600"
              >
                <Mail className="h-3.5 w-3.5" /> Email PDF
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadWithAuth(
                    `/api/invoices/${selectedInvoice.id}/pdf`,
                    `${selectedInvoice.invoiceNumber}.pdf`
                  ).catch((e) => showToast(e.message, 'error'))
                }
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium"
              >
                <Download className="h-3.5 w-3.5" /> PDF
              </button>
              <button
                type="button"
                onClick={() => handleDuplicate(selectedInvoice)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium"
              >
                <FilePlus2 className="h-3.5 w-3.5" /> Duplicate
              </button>
              <a
                href={`/public/invoice/${selectedInvoice.publicToken}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Public Link
              </a>
              {selectedInvoice.balanceDue > 0 && selectedInvoice.status !== 'CANCELLED' && (
                <button
                  type="button"
                  onClick={() => {
                    setCnTarget(selectedInvoice);
                    setCnAmount(String(selectedInvoice.balanceDue));
                    setCnReason('');
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium"
                >
                  <ReceiptText className="h-3.5 w-3.5" /> Credit Note
                </button>
              )}
            </div>

            {/* UPI QR Preview */}
            {selectedInvoice.upiQrDataUrl && selectedInvoice.balanceDue > 0 && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3 flex items-center gap-3">
                <img
                  src={selectedInvoice.upiQrDataUrl}
                  alt="UPI QR"
                  className="h-20 w-20 rounded border border-slate-200 bg-white p-1 shrink-0"
                />
                <div className="text-xs space-y-1 min-w-0">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">UPI Quick Pay</p>
                  <p className="text-slate-500 truncate">{settings?.upiId}</p>
                  {selectedInvoice.upiUri && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(selectedInvoice.upiUri!);
                        showToast('UPI payment link copied', 'success');
                      }}
                      className="text-sky-600 dark:text-sky-400 hover:underline"
                    >
                      Copy UPI Link
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Line Items Summary */}
            <div className="space-y-1.5 text-xs border-t border-slate-100 dark:border-slate-800 pt-3">
              <p className="font-semibold text-slate-700 dark:text-slate-300">Items</p>
              {selectedInvoice.items.map((it, i) => (
                <div key={i} className="flex justify-between gap-2 text-slate-600 dark:text-slate-400">
                  <span className="truncate">{it.description}</span>
                  <span className="font-mono tabular-nums shrink-0">
                    {formatINR(it.lineTotal, { decimals: 2 })}
                  </span>
                </div>
              ))}
            </div>

            {/* Payments History */}
            {(selectedInvoice.payments || []).length > 0 && (
              <div className="space-y-1.5 text-xs border-t border-slate-100 dark:border-slate-800 pt-3">
                <p className="font-semibold text-slate-700 dark:text-slate-300">Payments Recorded</p>
                {selectedInvoice.payments!.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-mono font-medium">{p.receiptNumber}</span>
                      <span className="text-slate-400 ml-1.5">{p.method}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {formatINR(p.amount, { decimals: 2 })}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          downloadWithAuth(`/api/payments/${p.id}/pdf`, `${p.receiptNumber}.pdf`).catch((e) =>
                            showToast(e.message, 'error')
                          )
                        }
                        title="Receipt PDF"
                        className="text-slate-400 hover:text-slate-700"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create / Edit Invoice Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {editing ? `Edit ${editing.invoiceNumber}` : 'New Invoice'}
              </h2>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Client</label>
                  <select
                    value={clientId}
                    onChange={(e) => handleClientChange(e.target.value)}
                    required
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                  >
                    <option value="">Select client...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.company && c.company !== c.name ? `(${c.company})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Issue Date</label>
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    required
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    required
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">GST Mode</label>
                  <select
                    value={gstMode}
                    onChange={(e) => setGstMode(e.target.value as GstMode)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="CGST_SGST">CGST + SGST (Intra-state)</option>
                    <option value="IGST">IGST (Inter-state)</option>
                    <option value="NONE">No GST</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Place of Supply</label>
                  <input
                    type="text"
                    value={placeOfSupply}
                    onChange={(e) => setPlaceOfSupply(e.target.value)}
                    placeholder="09-Uttar Pradesh"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Project Name</label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="Optional project"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Reference # / PO</label>
                  <input
                    type="text"
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    placeholder="Optional ref / PO"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 py-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={recurring}
                    onChange={(e) => setRecurring(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Recurring Invoice Schedule
                </label>

                {recurring && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Cycle</label>
                    <select
                      value={recurringCycle}
                      onChange={(e) => setRecurringCycle(e.target.value as BillingCycle)}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    >
                      <option value="MONTHLY">Monthly</option>
                      <option value="QUARTERLY">Quarterly</option>
                      <option value="YEARLY">Yearly</option>
                    </select>
                  </div>
                )}
              </div>

              <DocumentLineItemsEditor
                items={items}
                onChange={setItems}
                gstMode={gstMode}
                applyRoundOff={applyRoundOff}
                onToggleRoundOff={setApplyRoundOff}
                adjustmentOverride={adjustmentOverride}
                adjustmentLabel={adjustmentLabel}
                onAdjustmentChange={({ adjustmentOverride: nextOv, adjustmentLabel: nextLbl }) => {
                  setAdjustmentOverride(nextOv);
                  setAdjustmentLabel(nextLbl);
                }}
                catalogItems={catalogItems}
                clientDomains={clientDomains}
                clientServices={clientServices}
                showAssetLinking
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Notes</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Payment instructions or renewal details..."
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Terms &amp; Conditions</label>
                  <textarea
                    rows={2}
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-sky-600 px-5 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {payTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Record Payment — {payTarget.invoiceNumber}</h2>
              <button type="button" onClick={() => setPayTarget(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleRecordPayment} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Amount (₹)</label>
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
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Payment Date</label>
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
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Method</label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="UPI">UPI</option>
                    <option value="BANK">Bank Transfer (NEFT/IMPS)</option>
                    <option value="CASH">Cash</option>
                    <option value="RAZORPAY">Razorpay</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">UTR / Reference</label>
                  <input
                    type="text"
                    value={payRef}
                    onChange={(e) => setPayRef(e.target.value)}
                    placeholder="UPI ref or txn ID"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Notes</label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPayTarget(null)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={paySaving}
                  className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {paySaving ? 'Saving...' : 'Save Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Post-Payment Extend Expiry Modal */}
      {extendCandidates.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Extend Linked Renewal Expiry?
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              This invoice is now fully paid and is linked to the following renewal item(s). Update their expiry/renewal dates now?
            </p>
            <div className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-xs">
              {extendCandidates.map((c) => (
                <div key={`${c.kind}-${c.id}`} className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{c.name}</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    {formatDateDDMMMYYYY(c.currentDate)} → {formatDateDDMMMYYYY(c.nextDate)}
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
                onClick={handleExtendLinkedRenewals}
                className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700"
              >
                Extend Dates
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Credit Note Modal */}
      {cnTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Issue Credit Note — {cnTarget.invoiceNumber}</h2>
              <button type="button" onClick={() => setCnTarget(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleIssueCreditNote} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Credit Amount (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={cnAmount}
                  onChange={(e) => setCnAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Reason</label>
                <input
                  type="text"
                  value={cnReason}
                  onChange={(e) => setCnReason(e.target.value)}
                  placeholder="Discount adjustment, service cancellation, etc."
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCnTarget(null)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={cnSaving}
                  className="rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {cnSaving ? 'Issuing...' : 'Issue Credit Note'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Invoice"
        message={`Delete ${deleteTarget?.invoiceNumber}? Associated payments and line items will also be removed.`}
        confirmLabel="Delete"
        danger
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
