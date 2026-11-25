import React, { useEffect, useState } from 'react';
import { Plus, Search, Upload, Download, Edit2, Trash2, X, Receipt } from 'lucide-react';
import { apiRequest, downloadWithAuth } from '../lib/api';
import {
  BillingCycle,
  ClientDTO,
  DomainDTO,
  ProviderAccountDTO,
  ServiceDTO,
  ServiceStatus,
  ServiceType,
} from '../../shared/types';
import { formatDateDDMMMYYYY } from '../../shared/dates';
import { formatINR } from '../../shared/currency';
import { UrgencyTag } from '../components/UrgencyTag';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CsvImportModal } from '../components/CsvImportModal';
import { useToast } from '../components/Toast';

interface ServicesPageProps {
  initialWindow?: string;
  onOpenClient: (clientId: string) => void;
  onOpenInvoice?: (invoiceId: string) => void;
  openCreateTrigger?: number;
}

const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  HOSTING: 'Web Hosting',
  EMAIL_HOSTING: 'Email Hosting',
  SSL: 'SSL Certificate',
  MAINTENANCE_AMC: 'Maintenance / AMC',
  CDN: 'CDN / Security',
  OTHER: 'Other Service',
};

const emptyServiceForm = {
  planName: '',
  type: 'HOSTING' as ServiceType,
  clientId: '',
  providerAccountId: '',
  startDate: '',
  renewalDate: '',
  billingCycle: 'YEARLY' as BillingCycle,
  costPrice: '2400',
  sellingPrice: '6000',
  autoRenew: false,
  status: 'ACTIVE' as ServiceStatus,
  domainIds: [] as string[],
  notes: '',
};

export function ServicesPage({ initialWindow = 'ALL', onOpenClient, onOpenInvoice, openCreateTrigger }: ServicesPageProps) {
  const { showToast } = useToast();
  const [services, setServices] = useState<ServiceDTO[]>([]);
  const [clients, setClients] = useState<ClientDTO[]>([]);
  const [providers, setProviders] = useState<ProviderAccountDTO[]>([]);
  const [domains, setDomains] = useState<DomainDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [windowFilter, setWindowFilter] = useState(initialWindow);
  const [loading, setLoading] = useState(true);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceDTO | null>(null);
  const [form, setForm] = useState(emptyServiceForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ServiceDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  async function loadMeta() {
    try {
      const [cRes, pRes, dRes] = await Promise.all([
        apiRequest<{ items: ClientDTO[] }>('/api/clients?pageSize=100'),
        apiRequest<{ items: ProviderAccountDTO[] }>('/api/providers'),
        apiRequest<{ items: DomainDTO[] }>('/api/domains?pageSize=100'),
      ]);
      setClients(cRes.items);
      setProviders(pRes.items);
      setDomains(dRes.items);
    } catch {
      // handled on main load
    }
  }

  async function loadServices() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        q,
        type: typeFilter,
        expiryWindow: windowFilter,
        page: String(page),
        pageSize: String(pageSize),
      });
      const res = await apiRequest<{ items: ServiceDTO[]; total: number }>(`/api/services?${params}`);
      setServices(res.items);
      setTotal(res.total);
      setSelectedIds([]);
    } catch (err: any) {
      showToast(err.message || 'Failed to load services', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMeta();
  }, []);

  useEffect(() => {
    setWindowFilter(initialWindow);
  }, [initialWindow]);

  useEffect(() => {
    loadServices();
  }, [q, typeFilter, windowFilter, page]);

  useEffect(() => {
    if (openCreateTrigger && openCreateTrigger > 0) {
      openAdd();
    }
  }, [openCreateTrigger]);

  function openAdd() {
    setEditing(null);
    setForm({
      ...emptyServiceForm,
      clientId: clients[0]?.id || '',
      providerAccountId: providers[0]?.id || '',
    });
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(s: ServiceDTO) {
    setEditing(s);
    setForm({
      planName: s.planName,
      type: s.type,
      clientId: s.clientId,
      providerAccountId: s.providerAccountId || '',
      startDate: s.startDate ? s.startDate.slice(0, 10) : '',
      renewalDate: s.renewalDate.slice(0, 10),
      billingCycle: s.billingCycle,
      costPrice: String(s.costPrice),
      sellingPrice: String(s.sellingPrice),
      autoRenew: s.autoRenew,
      status: s.status,
      domainIds: (s.linkedDomains || []).map((d) => d.id),
      notes: s.notes || '',
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.planName.trim() || !form.clientId || !form.renewalDate) {
      setFormError('Plan name, client, and renewal date are required');
      return;
    }

    const payload = {
      planName: form.planName.trim(),
      type: form.type,
      clientId: form.clientId,
      providerAccountId: form.providerAccountId || null,
      startDate: form.startDate || null,
      renewalDate: form.renewalDate,
      billingCycle: form.billingCycle,
      costPrice: Number(form.costPrice || 0),
      sellingPrice: Number(form.sellingPrice || 0),
      autoRenew: form.autoRenew,
      ...(editing ? { status: form.status } : {}),
      domainIds: form.domainIds,
      notes: form.notes.trim() || null,
    };

    setSaving(true);
    try {
      if (editing) {
        await apiRequest(`/api/services/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToast(`Updated ${payload.planName}`, 'success');
      } else {
        await apiRequest('/api/services', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast(`Added ${payload.planName}`, 'success');
      }
      setModalOpen(false);
      loadServices();
    } catch (err: any) {
      setFormError(err.message || 'Could not save service');
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkAutoRenew(autoRenew: boolean) {
    try {
      const res = await apiRequest<{ updatedCount: number }>('/api/services/bulk', {
        method: 'PATCH',
        body: JSON.stringify({ ids: selectedIds, autoRenew }),
      });
      showToast(`Updated ${res.updatedCount} services`, 'success');
      loadServices();
    } catch (err: any) {
      showToast(err.message || 'Bulk update failed', 'error');
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(`/api/services/${deleteTarget.id}`, { method: 'DELETE' });
      showToast(`Deleted ${deleteTarget.planName}`, 'success');
      setDeleteTarget(null);
      loadServices();
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  }

  async function handleBillRenewal(s: ServiceDTO) {
    try {
      const res = await apiRequest<{ invoice: { id: string; invoiceNumber: string } }>('/api/invoices/from-renewal', {
        method: 'POST',
        body: JSON.stringify({ kind: 'SERVICE', id: s.id }),
      });
      showToast(`Created draft renewal invoice ${res.invoice.invoiceNumber}`, 'success');
      onOpenInvoice?.(res.invoice.id);
    } catch (err: any) {
      showToast(err.message || 'Could not generate renewal invoice', 'error');
    }
  }

  const clientDomains = domains.filter((d) => !form.clientId || d.clientId === form.clientId);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Hosting &amp; Services
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {total} recurring hosting, email, SSL, CDN, and maintenance/AMC plans (never store plain-text passwords)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Upload className="h-3.5 w-3.5" /> Import CSV
          </button>
          <button
            type="button"
            onClick={() => downloadWithAuth('/api/services/export', 'services-export.csv').catch((e) => showToast(e.message, 'error'))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" /> Add Service
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search plan name, client, provider, domain..."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm"
          />
        </div>

        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium"
        >
          <option value="ALL">All Service Types</option>
          {(Object.keys(SERVICE_TYPE_LABELS) as ServiceType[]).map((t) => (
            <option key={t} value={t}>{SERVICE_TYPE_LABELS[t]}</option>
          ))}
        </select>

        <select
          value={windowFilter}
          onChange={(e) => {
            setWindowFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium"
        >
          <option value="ALL">All Renewal Windows</option>
          <option value="expired">Expired</option>
          <option value="7">Within 7 Days</option>
          <option value="30">Within 30 Days</option>
          <option value="60">Within 60 Days</option>
          <option value="healthy">Healthy (&gt; 60 Days)</option>
        </select>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/40 px-4 py-2.5 text-xs">
          <span className="font-medium text-sky-900 dark:text-sky-200 font-mono">
            {selectedIds.length} service(s) selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleBulkAutoRenew(true)}
              className="rounded border border-sky-300 dark:border-sky-800 bg-white dark:bg-slate-900 px-2.5 py-1 font-medium"
            >
              Enable Auto-Renew
            </button>
            <button
              type="button"
              onClick={() => handleBulkAutoRenew(false)}
              className="rounded border border-sky-300 dark:border-sky-800 bg-white dark:bg-slate-900 px-2.5 py-1 font-medium"
            >
              Disable Auto-Renew
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
        ) : services.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">No services found</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Add hosting plans, email suites, SSLs, or maintenance contracts.
            </p>
            <button
              type="button"
              onClick={openAdd}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700"
            >
              <Plus className="h-3.5 w-3.5" /> Add Service
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-3 py-2.5 w-9">
                    <input
                      type="checkbox"
                      checked={services.length > 0 && selectedIds.length === services.length}
                      onChange={(e) =>
                        setSelectedIds(e.target.checked ? services.map((s) => s.id) : [])
                      }
                      aria-label="Select all services"
                    />
                  </th>
                  <th className="px-3 py-2.5 font-medium">Service / Plan</th>
                  <th className="px-3 py-2.5 font-medium">Client &amp; Domains</th>
                  <th className="px-3 py-2.5 font-medium">Provider / Cycle</th>
                  <th className="px-3 py-2.5 font-medium">Renewal Date</th>
                  <th className="px-3 py-2.5 font-medium text-right">Sell / Cost</th>
                  <th className="px-3 py-2.5 font-medium text-right">Urgency</th>
                  <th className="px-3 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {services.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(s.id)}
                        onChange={(e) =>
                          setSelectedIds((prev) =>
                            e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                          )
                        }
                        aria-label={`Select ${s.planName}`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-900 dark:text-slate-100 text-xs sm:text-sm">
                        {s.planName}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {SERVICE_TYPE_LABELS[s.type]}
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span>{s.autoRenew ? 'Auto-renew' : 'Manual'}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <button
                        type="button"
                        onClick={() => onOpenClient(s.clientId)}
                        className="font-medium text-slate-700 dark:text-slate-300 hover:text-sky-600 dark:hover:text-sky-400"
                      >
                        {s.client?.name || '—'}
                      </button>
                      {s.linkedDomains && s.linkedDomains.length > 0 && (
                        <div className="font-mono text-[11px] text-slate-400 mt-0.5">
                          {s.linkedDomains.map((d) => d.name).join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-400">
                      <div>{s.providerAccount?.name || 'Manual'}</div>
                      <div className="text-[11px] text-slate-400">{s.billingCycle}</div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {formatDateDDMMMYYYY(s.renewalDate)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                      <div className="text-slate-900 dark:text-slate-100 font-medium">{formatINR(s.sellingPrice)}</div>
                      <div className="text-[11px] text-slate-400">Cost {formatINR(s.costPrice)}</div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <UrgencyTag targetDate={s.renewalDate} />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleBillRenewal(s)}
                          className="rounded p-1.5 text-slate-500 hover:bg-sky-50 dark:hover:bg-sky-950/40 hover:text-sky-600 dark:hover:text-sky-400"
                          title="Generate renewal invoice"
                        >
                          <Receipt className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(s)}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
                          title="Edit service"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(s)}
                          className="rounded p-1.5 text-slate-500 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400"
                          title="Delete service"
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
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
            <span className="font-mono tabular-nums">
              Page {page} of {totalPages} ({total} services)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded border border-slate-200 dark:border-slate-700 px-3 py-1 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border border-slate-200 dark:border-slate-700 px-3 py-1 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {editing ? `Edit Service — ${editing.planName}` : 'Add Hosting / Recurring Service'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
              {formError && (
                <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Plan / Service Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.planName}
                    onChange={(e) => setForm({ ...form, planName: e.target.value })}
                    placeholder="Cloud Business Hosting (India DC)"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Service Type
                  </label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as ServiceType })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  >
                    {(Object.keys(SERVICE_TYPE_LABELS) as ServiceType[]).map((t) => (
                      <option key={t} value={t}>{SERVICE_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Client *
                  </label>
                  <select
                    required
                    value={form.clientId}
                    onChange={(e) => setForm({ ...form, clientId: e.target.value, domainIds: [] })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="">Select client...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Provider Account
                  </label>
                  <select
                    value={form.providerAccountId}
                    onChange={(e) => setForm({ ...form, providerAccountId: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="">Manual / Unassigned</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Renewal Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={form.renewalDate}
                    onChange={(e) => setForm({ ...form, renewalDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Billing Cycle
                  </label>
                  <select
                    value={form.billingCycle}
                    onChange={(e) => setForm({ ...form, billingCycle: e.target.value as BillingCycle })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="QUARTERLY">Quarterly</option>
                    <option value="YEARLY">Yearly</option>
                    <option value="MULTI_YEAR">Multi-Year</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Cost Price (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.costPrice}
                    onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Selling Price (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.sellingPrice}
                    onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                  />
                </div>
              </div>

              {clientDomains.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Linked Client Domains
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {clientDomains.map((d) => {
                      const checked = form.domainIds.includes(d.id);
                      return (
                        <label
                          key={d.id}
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-mono cursor-pointer ${
                            checked
                              ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300'
                              : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                domainIds: e.target.checked
                                  ? [...prev.domainIds, d.id]
                                  : prev.domainIds.filter((id) => id !== d.id),
                              }))
                            }
                            className="sr-only"
                          />
                          {d.name}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Notes (never store plain-text passwords)
                </label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.autoRenew}
                  onChange={(e) => setForm({ ...form, autoRenew: e.target.checked })}
                  className="rounded border-slate-300 text-sky-600"
                />
                Auto-renew enabled
              </label>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editing ? 'Save Service' : 'Create Service'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Service"
        message={`Are you sure you want to delete "${deleteTarget?.planName}"?`}
        confirmLabel="Delete Service"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <CsvImportModal
        open={importOpen}
        target="services"
        onClose={() => setImportOpen(false)}
        onImported={loadServices}
      />
    </div>
  );
}
