import React, { useEffect, useState } from 'react';
import {
  Plus,
  Search,
  Download,
  Upload,
  Copy,
  ArrowRightCircle,
  Edit2,
  Trash2,
  X,
  BookOpen,
  ExternalLink,
  Send,
  Mail,
} from 'lucide-react';
import { apiRequest, downloadWithAuth } from '../lib/api';
import {
  CatalogItemDTO,
  ClientDTO,
  EstimateDTO,
  EstimateStatus,
  GstMode,
  SettingsDTO,
} from '../../shared/types';
import { BillingLineInput, formatPlaceOfSupply, resolveDefaultGstMode } from '../../shared/billing';
import { formatDateDDMMMYYYY } from '../../shared/dates';
import { formatINR } from '../../shared/currency';
import { DocumentLineItemsEditor } from '../components/DocumentLineItemsEditor';
import { CsvImportModal } from '../components/CsvImportModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';

interface EstimatesPageProps {
  onOpenClient: (clientId: string) => void;
  onConvertedToInvoice: (invoiceId: string) => void;
  openCreateTrigger?: number;
}

const STATUS_STYLE: Record<EstimateStatus, string> = {
  DRAFT: 'text-slate-600 dark:text-slate-400',
  SENT: 'text-sky-600 dark:text-sky-400',
  VIEWED: 'text-indigo-600 dark:text-indigo-400',
  ACCEPTED: 'text-emerald-600 dark:text-emerald-400',
  REJECTED: 'text-red-600 dark:text-red-400',
  EXPIRED: 'text-amber-600 dark:text-amber-400',
};

function todayIsoDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function EstimatesPage({
  onOpenClient,
  onConvertedToInvoice,
  openCreateTrigger,
}: EstimatesPageProps) {
  const { showToast } = useToast();
  const [estimates, setEstimates] = useState<EstimateDTO[]>([]);
  const [clients, setClients] = useState<ClientDTO[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItemDTO[]>([]);
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<EstimateDTO | null>(null);
  const [clientId, setClientId] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [projectName, setProjectName] = useState('');
  const [placeOfSupply, setPlaceOfSupply] = useState('');
  const [issueDate, setIssueDate] = useState(todayIsoDate(0));
  const [validUntil, setValidUntil] = useState(todayIsoDate(15));
  const [gstMode, setGstMode] = useState<GstMode>('CGST_SGST');
  const [applyRoundOff, setApplyRoundOff] = useState(true);
  const [adjustmentOverride, setAdjustmentOverride] = useState<number | null>(null);
  const [adjustmentLabel, setAdjustmentLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [items, setItems] = useState<BillingLineInput[]>([
    { itemName: '', description: '', hsnSac: '998314', qty: 1, rate: 0, discount: 0, taxPercent: 18 },
  ]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<EstimateDTO | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Catalog Manager modal
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [catHsn, setCatHsn] = useState('998314');
  const [catRate, setCatRate] = useState('1500');
  const [catTax, setCatTax] = useState('18');

  async function loadMeta() {
    try {
      const [cRes, catRes, sRes] = await Promise.all([
        apiRequest<{ items: ClientDTO[] }>('/api/clients?pageSize=100'),
        apiRequest<{ items: CatalogItemDTO[] }>('/api/catalog'),
        apiRequest<{ settings: SettingsDTO }>('/api/settings'),
      ]);
      setClients(cRes.items);
      setCatalogItems(catRes.items);
      setSettings(sRes.settings);
    } catch {
      // handled on main load
    }
  }

  async function loadEstimates() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q, status: statusFilter });
      const res = await apiRequest<{ items: EstimateDTO[] }>(`/api/estimates?${params}`);
      setEstimates(res.items);
    } catch (err: any) {
      showToast(err.message || 'Failed to load estimates', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMeta();
  }, []);

  useEffect(() => {
    loadEstimates();
  }, [q, statusFilter]);

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
    setValidUntil(todayIsoDate(15));
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
    setNotes('');
    setTerms(settings?.defaultEstimateTerms || '');
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

  function openEdit(est: EstimateDTO) {
    setEditing(est);
    setClientId(est.clientId);
    setReferenceNumber(est.referenceNumber || '');
    setProjectName(est.projectName || '');
    setPlaceOfSupply(est.placeOfSupply || formatPlaceOfSupply(est.client?.state) || '');
    setIssueDate(est.issueDate.slice(0, 10));
    setValidUntil(est.validUntil.slice(0, 10));
    setGstMode(est.gstMode);
    const hasCustom = Boolean(est.adjustmentLabel) || Math.abs(est.roundOff) > 1;
    setApplyRoundOff(est.roundOff !== 0);
    setAdjustmentOverride(hasCustom ? est.roundOff : null);
    setAdjustmentLabel(est.adjustmentLabel || '');
    setNotes(est.notes || '');
    setTerms(est.terms || '');
    setItems(
      est.items.map((it) => ({
        itemName: it.itemName || '',
        description: it.description,
        hsnSac: it.hsnSac,
        qty: it.qty,
        rate: it.rate,
        discount: it.discount,
        taxPercent: it.taxPercent,
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
        validUntil,
        gstMode,
        applyRoundOff,
        adjustmentOverride,
        adjustmentLabel: adjustmentLabel.trim() || null,
        notes: notes.trim() || null,
        terms: terms.trim() || null,
        items,
      };
      if (editing) {
        await apiRequest(`/api/estimates/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToast(`Updated ${editing.estimateNumber}`, 'success');
      } else {
        await apiRequest('/api/estimates', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('Estimate created', 'success');
      }
      setModalOpen(false);
      loadEstimates();
    } catch (err: any) {
      setFormError(err.message || 'Could not save estimate');
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(est: EstimateDTO, status: EstimateStatus) {
    try {
      await apiRequest(`/api/estimates/${est.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      showToast(`${est.estimateNumber} marked ${status}`, 'success');
      loadEstimates();
    } catch (err: any) {
      showToast(err.message || 'Status update failed', 'error');
    }
  }

  async function handleEmailEstimate(est: EstimateDTO) {
    try {
      const res = await apiRequest<{ dryRun?: boolean }>(`/api/estimates/${est.id}/send`, {
        method: 'POST',
        body: JSON.stringify({ channel: 'EMAIL' }),
      });
      showToast(
        res.dryRun ? `Dry-run email logged for ${est.estimateNumber}` : `Emailed ${est.estimateNumber} PDF to client`,
        'success'
      );
      loadEstimates();
    } catch (err: any) {
      showToast(err.message || 'Failed to email estimate', 'error');
    }
  }

  async function handleConvert(est: EstimateDTO) {
    try {
      const res = await apiRequest<{ invoice: { id: string; invoiceNumber: string } }>(
        `/api/estimates/${est.id}/convert`,
        { method: 'POST' }
      );
      showToast(`Converted to Invoice ${res.invoice.invoiceNumber}`, 'success');
      loadEstimates();
      onConvertedToInvoice(res.invoice.id);
    } catch (err: any) {
      showToast(err.message || 'Conversion failed', 'error');
    }
  }

  function copyPublicLink(token: string) {
    const url = `${window.location.origin}/public/estimate/${token}`;
    navigator.clipboard.writeText(url);
    showToast('Public approval link copied', 'success');
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(`/api/estimates/${deleteTarget.id}`, { method: 'DELETE' });
      showToast(`Deleted ${deleteTarget.estimateNumber}`, 'success');
      setDeleteTarget(null);
      loadEstimates();
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  }

  async function handleAddCatalog(e: React.FormEvent) {
    e.preventDefault();
    if (!catName.trim()) return;
    try {
      await apiRequest('/api/catalog', {
        method: 'POST',
        body: JSON.stringify({
          name: catName.trim(),
          description: catDesc.trim() || null,
          hsnSac: catHsn.trim() || null,
          defaultRate: Number(catRate || 0),
          taxPercent: Number(catTax || 18),
        }),
      });
      setCatName('');
      setCatDesc('');
      const res = await apiRequest<{ items: CatalogItemDTO[] }>('/api/catalog');
      setCatalogItems(res.items);
      showToast('Catalog item saved', 'success');
    } catch (err: any) {
      showToast(err.message || 'Could not add catalog item', 'error');
    }
  }

  async function handleDeleteCatalog(id: string) {
    try {
      await apiRequest(`/api/catalog/${id}`, { method: 'DELETE' });
      setCatalogItems((prev) => prev.filter((x) => x.id !== id));
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Estimates</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Create itemized GST quotations, share public approval links, and convert to invoices in one click
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              downloadWithAuth('/api/estimates/export', 'estimates-export.csv').catch((e) =>
                showToast(e.message, 'error')
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Upload className="h-3.5 w-3.5" /> Import CSV
          </button>
          <button
            type="button"
            onClick={() => setCatalogOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <BookOpen className="h-3.5 w-3.5" /> Service Catalog ({catalogItems.length})
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" /> New Estimate
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
            placeholder="Search estimate #, project, reference, client, or item..."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1">
          {(['ALL', 'DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {st === 'ALL' ? 'All' : st.charAt(0) + st.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
        ) : estimates.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">No estimates yet</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Create your first quotation to share a live approval link or PDF with a client.
            </p>
            <button
              type="button"
              onClick={openCreate}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700"
            >
              <Plus className="h-3.5 w-3.5" /> Create First Estimate
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Estimate #</th>
                  <th className="px-4 py-3 font-medium">Client / Project</th>
                  <th className="px-4 py-3 font-medium">Issue / Valid Until</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {estimates.map((est) => (
                  <tr key={est.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {est.estimateNumber}
                      {est.referenceNumber && (
                        <div className="text-[11px] font-sans font-normal text-slate-500 dark:text-slate-400 truncate max-w-[180px]">
                          Ref: {est.referenceNumber}
                        </div>
                      )}
                      {est.convertedInvoiceId && (
                        <div className="text-[11px] font-sans font-normal text-emerald-600 dark:text-emerald-400">
                          Converted to invoice
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => onOpenClient(est.clientId)}
                        className="font-medium text-slate-900 dark:text-slate-100 hover:text-sky-600 dark:hover:text-sky-400 text-left"
                      >
                        {est.client?.name || 'Client'}
                      </button>
                      {(est.projectName || est.placeOfSupply) && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-xs">
                          {[est.projectName, est.placeOfSupply].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {est.clientComment && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-xs">
                          Note: &ldquo;{est.clientComment}&rdquo;
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
                      <div>{formatDateDDMMMYYYY(est.issueDate)}</div>
                      <div className="text-[11px] text-slate-400">Valid till {formatDateDDMMMYYYY(est.validUntil)}</div>
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold whitespace-nowrap">
                      <span className={STATUS_STYLE[est.status]}>{est.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                      {formatINR(est.total, { decimals: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        {est.status === 'DRAFT' && (
                          <button
                            type="button"
                            onClick={() => handleStatusChange(est, 'SENT')}
                            title="Mark as Sent"
                            className="rounded p-1.5 text-slate-500 hover:text-sky-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Send className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleEmailEstimate(est)}
                          title="Email Estimate PDF"
                          className="rounded p-1.5 text-slate-500 hover:text-sky-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Mail className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleConvert(est)}
                          title={est.convertedInvoiceId ? 'Open Linked Invoice' : 'Convert to Invoice'}
                          className="rounded p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50"
                        >
                          <ArrowRightCircle className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            downloadWithAuth(`/api/estimates/${est.id}/pdf`, `${est.estimateNumber}.pdf`).catch((e) =>
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
                          onClick={() => copyPublicLink(est.publicToken)}
                          title="Copy Public Approval Link"
                          className="rounded p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <a
                          href={`/public/estimate/${est.publicToken}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Open Public View"
                          className="rounded p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => openEdit(est)}
                          title="Edit Estimate"
                          className="rounded p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(est)}
                          title="Delete Estimate"
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

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {editing ? `Edit ${editing.estimateNumber}` : 'New Estimate'}
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
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Valid Until</label>
                  <input
                    type="date"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                    required
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
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
                    placeholder="Website Redesign, Domain..."
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Reference # / PO</label>
                  <input
                    type="text"
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    placeholder="Meeting / Email / PO ref"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>
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
                onOpenCatalogManager={() => setCatalogOpen(true)}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Notes</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Project scope summary or payment schedule note..."
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
                  {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Estimate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Catalog Manager Modal */}
      {catalogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Saved Service Catalog</h2>
              <button type="button" onClick={() => setCatalogOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <form onSubmit={handleAddCatalog} className="grid grid-cols-1 sm:grid-cols-6 gap-2.5 items-end">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Item Name</label>
                  <input
                    type="text"
                    required
                    value={catName}
                    onChange={(e) => setCatName(e.target.value)}
                    placeholder="e.g. SSL Setup"
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">HSN/SAC</label>
                  <input
                    type="text"
                    value={catHsn}
                    onChange={(e) => setCatHsn(e.target.value)}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Rate (₹)</label>
                  <input
                    type="number"
                    value={catRate}
                    onChange={(e) => setCatRate(e.target.value)}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">GST %</label>
                  <input
                    type="number"
                    value={catTax}
                    onChange={(e) => setCatTax(e.target.value)}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
                >
                  Add Item
                </button>
              </form>

              <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800">
                {catalogItems.map((it) => (
                  <div key={it.id} className="flex items-center justify-between px-3.5 py-2.5 text-xs">
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-100">{it.name}</p>
                      <p className="text-slate-500">
                        HSN/SAC: <span className="font-mono">{it.hsnSac || '—'}</span> · GST {it.taxPercent}%
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-semibold tabular-nums">{formatINR(it.defaultRate)}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteCatalog(it.id)}
                        className="text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <CsvImportModal
        open={importOpen}
        target="estimates"
        onClose={() => setImportOpen(false)}
        onImported={() => loadEstimates()}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Estimate"
        message={`Delete ${deleteTarget?.estimateNumber}? This action cannot be undone.`}
        confirmLabel="Delete"
        danger
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
