import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Upload, Download, Edit2, Trash2, X, ArrowUpDown, Receipt, ShieldCheck, RefreshCw } from 'lucide-react';
import { apiRequest, downloadWithAuth } from '../lib/api';
import { ClientDTO, DomainDTO, DomainStatus, ProviderAccountDTO, WhoPays } from '../../shared/types';
import { formatDateDDMMMYYYY } from '../../shared/dates';
import { formatINR } from '../../shared/currency';
import { UrgencyTag } from '../components/UrgencyTag';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CsvImportModal } from '../components/CsvImportModal';
import { QuickAddProviderBox } from '../components/QuickAddProviderBox';
import { useToast } from '../components/Toast';

interface DomainsPageProps {
  initialWindow?: string;
  onOpenClient: (clientId: string) => void;
  onOpenInvoice?: (invoiceId: string) => void;
  openCreateTrigger?: number;
}

const emptyDomainForm = {
  name: '',
  clientId: '',
  providerAccountId: '',
  registeredOn: '',
  expiryDate: '',
  autoRenew: false,
  nameserversText: '',
  dnsProvider: '',
  whoisPrivacy: true,
  costPrice: '749',
  sellingPrice: '1200',
  renewalYears: '1',
  whoPays: 'CLIENT' as WhoPays,
  status: 'ACTIVE' as DomainStatus,
  notes: '',
};

export function DomainsPage({ initialWindow = 'ALL', onOpenClient, onOpenInvoice, openCreateTrigger }: DomainsPageProps) {
  const { showToast } = useToast();
  const [domains, setDomains] = useState<DomainDTO[]>([]);
  const [clients, setClients] = useState<ClientDTO[]>([]);
  const [providers, setProviders] = useState<ProviderAccountDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [q, setQ] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [windowFilter, setWindowFilter] = useState(initialWindow);
  const [sortBy, setSortBy] = useState<'expiry' | 'name' | 'price'>('expiry');
  const [sortAsc, setSortAsc] = useState(true);
  const [loading, setLoading] = useState(true);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkAutoRenew, setBulkAutoRenew] = useState<string>('');
  const [bulkWhoPays, setBulkWhoPays] = useState<string>('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DomainDTO | null>(null);
  const [form, setForm] = useState(emptyDomainForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [quickAddProviderOpen, setQuickAddProviderOpen] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<DomainDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [verifyingRdapAll, setVerifyingRdapAll] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  async function loadMeta() {
    try {
      const [cRes, pRes] = await Promise.all([
        apiRequest<{ items: ClientDTO[] }>('/api/clients?pageSize=100'),
        apiRequest<{ items: ProviderAccountDTO[] }>('/api/providers'),
      ]);
      setClients(cRes.items);
      setProviders(pRes.items);
    } catch {
      // handled on main load
    }
  }

  async function loadDomains() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        q,
        clientId: clientFilter,
        providerAccountId: providerFilter,
        expiryWindow: windowFilter,
        page: String(page),
        pageSize: String(pageSize),
      });
      const res = await apiRequest<{ items: DomainDTO[]; total: number }>(`/api/domains?${params}`);
      setDomains(res.items);
      setTotal(res.total);
      setSelectedIds([]);
    } catch (err: any) {
      showToast(err.message || 'Failed to load domains', 'error');
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
    loadDomains();
  }, [q, clientFilter, providerFilter, windowFilter, page]);

  useEffect(() => {
    if (openCreateTrigger && openCreateTrigger > 0) {
      openAdd();
    }
  }, [openCreateTrigger]);

  const sortedDomains = useMemo(() => {
    const arr = [...domains];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'expiry') {
        cmp = new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
      } else if (sortBy === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else {
        cmp = a.sellingPrice - b.sellingPrice;
      }
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [domains, sortBy, sortAsc]);

  function openAdd() {
    setEditing(null);
    setForm({
      ...emptyDomainForm,
      clientId: clients[0]?.id || '',
      providerAccountId: providers[0]?.id || '',
    });
    setQuickAddProviderOpen(false);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(d: DomainDTO) {
    setEditing(d);
    setForm({
      name: d.name,
      clientId: d.clientId,
      providerAccountId: d.providerAccountId || '',
      registeredOn: d.registeredOn ? d.registeredOn.slice(0, 10) : '',
      expiryDate: d.expiryDate.slice(0, 10),
      autoRenew: d.autoRenew,
      nameserversText: (d.nameservers || []).join(', '),
      dnsProvider: d.dnsProvider || '',
      whoisPrivacy: d.whoisPrivacy,
      costPrice: String(d.costPrice),
      sellingPrice: String(d.sellingPrice),
      renewalYears: String(d.renewalYears),
      whoPays: d.whoPays,
      status: d.status,
      notes: d.notes || '',
    });
    setQuickAddProviderOpen(false);
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.clientId) {
      setFormError('Please select a client');
      return;
    }
    if (!form.expiryDate) {
      setFormError('Expiry date is required');
      return;
    }

    const payload = {
      name: form.name.trim().toLowerCase(),
      clientId: form.clientId,
      providerAccountId: form.providerAccountId || null,
      registeredOn: form.registeredOn || null,
      expiryDate: form.expiryDate,
      autoRenew: form.autoRenew,
      nameservers: form.nameserversText
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
      dnsProvider: form.dnsProvider.trim() || null,
      whoisPrivacy: form.whoisPrivacy,
      costPrice: Number(form.costPrice || 0),
      sellingPrice: Number(form.sellingPrice || 0),
      renewalYears: Number(form.renewalYears || 1),
      whoPays: form.whoPays,
      ...(editing ? { status: form.status } : {}),
      notes: form.notes.trim() || null,
    };

    setSaving(true);
    try {
      if (editing) {
        await apiRequest(`/api/domains/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToast(`Updated ${payload.name}`, 'success');
      } else {
        await apiRequest('/api/domains', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast(`Added domain ${payload.name}`, 'success');
      }
      setModalOpen(false);
      loadDomains();
    } catch (err: any) {
      setFormError(err.message || 'Could not save domain');
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkApply() {
    if (selectedIds.length === 0) return;
    const body: Record<string, any> = { ids: selectedIds };
    if (bulkAutoRenew === 'true') body.autoRenew = true;
    if (bulkAutoRenew === 'false') body.autoRenew = false;
    if (bulkWhoPays) body.whoPays = bulkWhoPays;

    if (Object.keys(body).length === 1) {
      showToast('Choose a field value to apply in bulk', 'info');
      return;
    }

    try {
      const res = await apiRequest<{ updatedCount: number }>('/api/domains/bulk', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      showToast(`Updated ${res.updatedCount} domains`, 'success');
      setBulkAutoRenew('');
      setBulkWhoPays('');
      loadDomains();
    } catch (err: any) {
      showToast(err.message || 'Bulk update failed', 'error');
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(`/api/domains/${deleteTarget.id}`, { method: 'DELETE' });
      showToast(`Deleted ${deleteTarget.name}`, 'success');
      setDeleteTarget(null);
      loadDomains();
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  }

  async function handleBillRenewal(d: DomainDTO) {
    try {
      const res = await apiRequest<{ invoice: { id: string; invoiceNumber: string } }>('/api/invoices/from-renewal', {
        method: 'POST',
        body: JSON.stringify({ kind: 'DOMAIN', id: d.id }),
      });
      showToast(`Created draft renewal invoice ${res.invoice.invoiceNumber}`, 'success');
      onOpenInvoice?.(res.invoice.id);
    } catch (err: any) {
      showToast(err.message || 'Could not generate renewal invoice', 'error');
    }
  }

  function toggleSort(col: 'expiry' | 'name' | 'price') {
    if (sortBy === col) setSortAsc(!sortAsc);
    else {
      setSortBy(col);
      setSortAsc(true);
    }
  }

  const allChecked = sortedDomains.length > 0 && selectedIds.length === sortedDomains.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Domains</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {total} tracked domains across Hostinger, GoDaddy, Spaceship, Cloudflare &amp; manual registrars
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={verifyingRdapAll}
            onClick={async () => {
              setVerifyingRdapAll(true);
              try {
                const res = await apiRequest<{ summary: string }>('/api/domains/verify-rdap-all', { method: 'POST' });
                showToast(res.summary, 'success');
                loadDomains();
              } catch (err: any) {
                showToast(err.message || 'RDAP batch verification failed', 'error');
              } finally {
                setVerifyingRdapAll(false);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${verifyingRdapAll ? 'animate-spin' : ''}`} /> Verify RDAP
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
            onClick={() => downloadWithAuth('/api/domains/export', 'domains-export.csv').catch((e) => showToast(e.message, 'error'))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" /> Add Domain
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
            placeholder="Search domain, client, DNS..."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <select
          value={windowFilter}
          onChange={(e) => {
            setWindowFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200"
        >
          <option value="ALL">All Expiry Windows</option>
          <option value="expired">Expired</option>
          <option value="7">Within 7 Days</option>
          <option value="30">Within 30 Days</option>
          <option value="60">Within 60 Days</option>
          <option value="healthy">Healthy (&gt; 60 Days)</option>
        </select>

        <select
          value={providerFilter}
          onChange={(e) => {
            setProviderFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200"
        >
          <option value="">All Providers</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <select
          value={clientFilter}
          onChange={(e) => {
            setClientFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200"
        >
          <option value="">All Clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/40 px-4 py-2.5 text-xs">
          <span className="font-medium text-sky-900 dark:text-sky-200 font-mono tabular-nums">
            {selectedIds.length} domain(s) selected
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={bulkAutoRenew}
              onChange={(e) => setBulkAutoRenew(e.target.value)}
              className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs"
            >
              <option value="">Set Auto-Renew...</option>
              <option value="true">Auto-Renew: On</option>
              <option value="false">Auto-Renew: Off</option>
            </select>
            <select
              value={bulkWhoPays}
              onChange={(e) => setBulkWhoPays(e.target.value)}
              className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs"
            >
              <option value="">Set Who Pays...</option>
              <option value="CLIENT">Client Pays</option>
              <option value="ME">Me (Owner Absorbs)</option>
            </select>
            <button
              type="button"
              onClick={handleBulkApply}
              className="rounded bg-sky-600 px-3 py-1 font-medium text-white hover:bg-sky-700"
            >
              Apply
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
        ) : sortedDomains.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">No domains match these filters</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Add a domain manually or import a CSV spreadsheet of client domains.
            </p>
            <button
              type="button"
              onClick={openAdd}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700"
            >
              <Plus className="h-3.5 w-3.5" /> Add Domain
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
                      checked={allChecked}
                      onChange={(e) =>
                        setSelectedIds(e.target.checked ? sortedDomains.map((d) => d.id) : [])
                      }
                      aria-label="Select all domains"
                    />
                  </th>
                  <th className="px-3 py-2.5 font-medium">
                    <button type="button" onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100">
                      Domain <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-medium">Client</th>
                  <th className="px-3 py-2.5 font-medium">Provider / DNS</th>
                  <th className="px-3 py-2.5 font-medium">
                    <button type="button" onClick={() => toggleSort('expiry')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100">
                      Expiry <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-medium text-right">
                    <button type="button" onClick={() => toggleSort('price')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100">
                      Sell / Cost <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-medium text-right">Urgency</th>
                  <th className="px-3 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {sortedDomains.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(d.id)}
                        onChange={(e) =>
                          setSelectedIds((prev) =>
                            e.target.checked ? [...prev, d.id] : prev.filter((id) => id !== d.id)
                          )
                        }
                        aria-label={`Select ${d.name}`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {d.name}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {d.autoRenew ? 'Auto-renew on' : 'Manual renew'}
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span>{d.whoPays === 'ME' ? 'Owner pays' : 'Client pays'}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <button
                        type="button"
                        onClick={() => onOpenClient(d.clientId)}
                        className="font-medium text-slate-700 dark:text-slate-300 hover:text-sky-600 dark:hover:text-sky-400"
                      >
                        {d.client?.name || '—'}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-400">
                      <div>{d.providerAccount?.name || 'Manual'}</div>
                      {d.dnsProvider && <div className="text-[11px] text-slate-400">{d.dnsProvider}</div>}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      <div>{formatDateDDMMMYYYY(d.expiryDate)}</div>
                      {d.rdapMismatch && d.rdapExpiryDate ? (
                        <div className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                          RDAP: {formatDateDDMMMYYYY(d.rdapExpiryDate)} (Mismatch)
                        </div>
                      ) : d.rdapExpiryDate ? (
                        <div className="text-[11px] text-emerald-600 dark:text-emerald-400">
                          RDAP verified
                        </div>
                      ) : d.rdapUnsupported ? (
                        <div className="text-[11px] text-slate-400">RDAP N/A</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                      <div className="text-slate-900 dark:text-slate-100 font-medium">{formatINR(d.sellingPrice)}</div>
                      <div className="text-[11px] text-slate-400">Cost {formatINR(d.costPrice)}</div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <UrgencyTag targetDate={d.expiryDate} />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          disabled={verifyingId === d.id}
                          onClick={async () => {
                            setVerifyingId(d.id);
                            try {
                              const res = await apiRequest<{ rdap: { supported: boolean; expiryDate?: string; error?: string }; mismatchDetected: boolean }>(
                                `/api/domains/${d.id}/verify-rdap`,
                                { method: 'POST' }
                              );
                              if (!res.rdap.supported) {
                                showToast(`${d.name}: RDAP unsupported by registry`, 'info');
                              } else if (res.mismatchDetected) {
                                showToast(`${d.name}: RDAP expiry differs from tracked date`, 'error');
                              } else {
                                showToast(`${d.name}: RDAP verified`, 'success');
                              }
                              loadDomains();
                            } catch (err: any) {
                              showToast(err.message || 'RDAP check failed', 'error');
                            } finally {
                              setVerifyingId(null);
                            }
                          }}
                          className="rounded p-1.5 text-slate-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:text-emerald-600 dark:hover:text-emerald-400"
                          title="Verify expiry via RDAP"
                        >
                          <ShieldCheck className={`h-4 w-4 ${verifyingId === d.id ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBillRenewal(d)}
                          className="rounded p-1.5 text-slate-500 hover:bg-sky-50 dark:hover:bg-sky-950/40 hover:text-sky-600 dark:hover:text-sky-400"
                          title="Generate renewal invoice"
                        >
                          <Receipt className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(d)}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
                          title="Edit domain"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(d)}
                          className="rounded p-1.5 text-slate-500 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400"
                          title="Delete domain"
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
              Page {page} of {totalPages} ({total} domains)
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
                {editing ? `Edit Domain — ${editing.name}` : 'Add New Domain'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setQuickAddProviderOpen(false);
                  setModalOpen(false);
                }}
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
                    Domain Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="clientdomain.in"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Client *
                  </label>
                  <select
                    required
                    value={form.clientId}
                    onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="">Select client...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Registrar / Provider Account
                    </label>
                    <button
                      type="button"
                      onClick={() => setQuickAddProviderOpen((v) => !v)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 whitespace-nowrap"
                    >
                      {quickAddProviderOpen ? (
                        'Close'
                      ) : (
                        <>
                          <Plus className="h-3 w-3" /> Add New
                        </>
                      )}
                    </button>
                  </div>
                  <select
                    value={form.providerAccountId}
                    onChange={(e) => {
                      if (e.target.value === '__ADD_NEW__') {
                        setQuickAddProviderOpen(true);
                        return;
                      }
                      setForm({ ...form, providerAccountId: e.target.value });
                    }}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="">Manual / Unassigned</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                    <option value="__ADD_NEW__">+ Add new registrar / provider...</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Expiry Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={form.expiryDate}
                    onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                  />
                </div>
                {quickAddProviderOpen && (
                  <div className="sm:col-span-2">
                    <QuickAddProviderBox
                      defaultType="REGISTRAR"
                      onCreated={(created) => {
                        setProviders((prev) =>
                          [...prev, created].sort((a, b) => a.name.localeCompare(b.name))
                        );
                        setForm((prev) => ({ ...prev, providerAccountId: created.id }));
                        setQuickAddProviderOpen(false);
                        showToast(`Added registrar ${created.name}`, 'success');
                      }}
                      onCancel={() => setQuickAddProviderOpen(false)}
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Registered On
                  </label>
                  <input
                    type="date"
                    value={form.registeredOn}
                    onChange={(e) => setForm({ ...form, registeredOn: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    DNS Provider
                  </label>
                  <input
                    type="text"
                    value={form.dnsProvider}
                    onChange={(e) => setForm({ ...form, dnsProvider: e.target.value })}
                    placeholder="Cloudflare / Hostinger DNS"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
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
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Renewal Years
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={form.renewalYears}
                    onChange={(e) => setForm({ ...form, renewalYears: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Who Pays Renewal
                  </label>
                  <select
                    value={form.whoPays}
                    onChange={(e) => setForm({ ...form, whoPays: e.target.value as WhoPays })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="CLIENT">Client Pays</option>
                    <option value="ME">Me (Included in Retainer)</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Nameservers (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={form.nameserversText}
                    onChange={(e) => setForm({ ...form, nameserversText: e.target.value })}
                    placeholder="ns1.cloudflare.com, ns2.cloudflare.com"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-xs"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Notes
                  </label>
                  <textarea
                    rows={2}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-6 text-sm text-slate-700 dark:text-slate-300">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.autoRenew}
                    onChange={(e) => setForm({ ...form, autoRenew: e.target.checked })}
                    className="rounded border-slate-300 text-sky-600"
                  />
                  Auto-renew enabled at registrar
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.whoisPrivacy}
                    onChange={(e) => setForm({ ...form, whoisPrivacy: e.target.checked })}
                    className="rounded border-slate-300 text-sky-600"
                  />
                  WHOIS Privacy active
                </label>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setQuickAddProviderOpen(false);
                    setModalOpen(false);
                  }}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editing ? 'Save Domain' : 'Create Domain'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Domain"
        message={`Are you sure you want to delete "${deleteTarget?.name}" from tracking?`}
        confirmLabel="Delete Domain"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <CsvImportModal
        open={importOpen}
        target="domains"
        onClose={() => setImportOpen(false)}
        onImported={loadDomains}
      />
    </div>
  );
}
