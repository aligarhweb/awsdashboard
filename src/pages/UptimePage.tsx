import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Plus,
  RefreshCw,
  Search,
  Pause,
  Play,
  Edit2,
  Trash2,
  ExternalLink,
  Copy,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  X,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { ClientDTO, DomainDTO, WebsiteDTO } from '../../shared/types';
import { formatDateDDMMMYYYY, getDaysLeftIST } from '../../shared/dates';
import { useToast } from '../components/Toast';

interface UptimePageProps {
  onOpenClient: (clientId: string) => void;
  openCreateTrigger?: number;
}

interface WebsiteSummaryStats {
  total: number;
  up: number;
  down: number;
  paused: number;
  sslExpiring14: number;
  avgUptime30d: number | null;
}

interface WebsiteFormState {
  id?: string;
  url: string;
  label: string;
  clientId: string;
  domainId: string;
  intervalMinutes: number;
  expectedStatusCode: number;
  requiredKeyword: string;
  timeoutMs: number;
  failureThreshold: number;
  alertContactsText: string;
  notifyClient: boolean;
  paused: boolean;
}

function formatDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) return 'Ongoing';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return `${m}m ${remS}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m`;
}

function formatTimestampShort(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function UptimePage({ onOpenClient, openCreateTrigger }: UptimePageProps) {
  const { showToast } = useToast();
  const [websites, setWebsites] = useState<WebsiteDTO[]>([]);
  const [summary, setSummary] = useState<WebsiteSummaryStats>({
    total: 0,
    up: 0,
    down: 0,
    paused: 0,
    sslExpiring14: 0,
    avgUptime30d: null,
  });
  const [clients, setClients] = useState<ClientDTO[]>([]);
  const [domains, setDomains] = useState<DomainDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'UP' | 'DOWN' | 'PAUSED'>('ALL');
  const [search, setSearch] = useState('');
  const [checkingAll, setCheckingAll] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Add/Edit modal
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<WebsiteFormState>({
    url: 'https://',
    label: '',
    clientId: '',
    domainId: '',
    intervalMinutes: 5,
    expectedStatusCode: 200,
    requiredKeyword: '',
    timeoutMs: 10000,
    failureThreshold: 2,
    alertContactsText: '',
    notifyClient: false,
    paused: false,
  });

  // Detail modal
  const [detailSite, setDetailSite] = useState<WebsiteDTO | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [webRes, clientRes, domainRes] = await Promise.all([
        apiRequest<{ items: WebsiteDTO[]; summary: WebsiteSummaryStats }>(
          `/api/websites?status=${statusFilter}&q=${encodeURIComponent(search.trim())}`
        ),
        apiRequest<{ items: ClientDTO[] }>('/api/clients'),
        apiRequest<{ items: DomainDTO[] }>('/api/domains'),
      ]);
      setWebsites(webRes.items || []);
      setSummary(webRes.summary);
      setClients(clientRes.items || []);
      setDomains(domainRes.items || []);
    } catch (err: any) {
      showToast(err.message || 'Could not load uptime monitors', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, [statusFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadAll();
    }, 180);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (openCreateTrigger && openCreateTrigger > 0) {
      openCreateModal();
    }
  }, [openCreateTrigger]);

  const clientDomains = useMemo(() => {
    if (!form.clientId) return [];
    return domains.filter((d) => d.clientId === form.clientId);
  }, [domains, form.clientId]);

  function openCreateModal() {
    const defaultClientId = clients[0]?.id || '';
    setForm({
      url: 'https://',
      label: '',
      clientId: defaultClientId,
      domainId: '',
      intervalMinutes: 5,
      expectedStatusCode: 200,
      requiredKeyword: '',
      timeoutMs: 10000,
      failureThreshold: 2,
      alertContactsText: '',
      notifyClient: false,
      paused: false,
    });
    setFormOpen(true);
  }

  function openEditModal(w: WebsiteDTO) {
    setForm({
      id: w.id,
      url: w.url,
      label: w.label || '',
      clientId: w.clientId,
      domainId: w.domainId || '',
      intervalMinutes: w.intervalMinutes,
      expectedStatusCode: w.expectedStatusCode,
      requiredKeyword: w.requiredKeyword || '',
      timeoutMs: w.timeoutMs,
      failureThreshold: w.failureThreshold,
      alertContactsText: (w.alertContacts || []).join(', '),
      notifyClient: w.notifyClient,
      paused: w.paused,
    });
    setFormOpen(true);
  }

  async function handleSaveForm(e: React.FormEvent) {
    e.preventDefault();
    if (!form.clientId) {
      showToast('Select a client for this website monitor', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        url: form.url.trim(),
        label: form.label.trim() || null,
        clientId: form.clientId,
        domainId: form.domainId || null,
        intervalMinutes: Number(form.intervalMinutes) || 5,
        expectedStatusCode: Number(form.expectedStatusCode) || 200,
        requiredKeyword: form.requiredKeyword.trim() || null,
        timeoutMs: Number(form.timeoutMs) || 10000,
        failureThreshold: Number(form.failureThreshold) || 2,
        alertContacts: form.alertContactsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        notifyClient: form.notifyClient,
        paused: form.paused,
      };

      if (form.id) {
        await apiRequest(`/api/websites/${form.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToast('Website monitor updated', 'success');
      } else {
        await apiRequest('/api/websites', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('Website monitor added', 'success');
      }
      setFormOpen(false);
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Could not save website monitor', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleCheckOne(w: WebsiteDTO) {
    setCheckingId(w.id);
    try {
      const res = await apiRequest<{
        result: { up: boolean; httpCode: number | null; responseMs: number; error: string | null };
        website: WebsiteDTO;
      }>(`/api/websites/${w.id}/check-now`, { method: 'POST' });

      if (res.result.up) {
        showToast(`${w.label || w.url} is UP (${res.result.httpCode}, ${res.result.responseMs}ms)`, 'success');
      } else {
        showToast(
          `${w.label || w.url} check failed: ${res.result.error || `HTTP ${res.result.httpCode}`}`,
          'error'
        );
      }
      if (detailSite?.id === w.id) {
        setDetailSite(res.website);
      }
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Probe failed', 'error');
    } finally {
      setCheckingId(null);
    }
  }

  async function handleCheckAll() {
    setCheckingAll(true);
    try {
      const res = await apiRequest<{ summary: string }>('/api/websites/check-all', {
        method: 'POST',
      });
      showToast(res.summary || 'All monitors checked', 'success');
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Batch check failed', 'error');
    } finally {
      setCheckingAll(false);
    }
  }

  async function handleTogglePause(w: WebsiteDTO) {
    try {
      await apiRequest(`/api/websites/${w.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ paused: !w.paused }),
      });
      showToast(w.paused ? 'Monitoring resumed' : 'Monitoring paused', 'info');
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Could not update monitor', 'error');
    }
  }

  async function handleDelete(id: string) {
    try {
      await apiRequest(`/api/websites/${id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      if (detailSite?.id === id) setDetailSite(null);
      showToast('Website monitor deleted', 'success');
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Could not delete website monitor', 'error');
    }
  }

  async function openDetail(w: WebsiteDTO) {
    setDetailSite(w);
    setLoadingDetail(true);
    try {
      const res = await apiRequest<{ website: WebsiteDTO }>(`/api/websites/${w.id}`);
      setDetailSite(res.website);
    } catch (err: any) {
      showToast(err.message || 'Could not load website details', 'error');
    } finally {
      setLoadingDetail(false);
    }
  }

  function copyPublicStatusUrl(token?: string | null) {
    if (!token) {
      showToast('Public status token missing; save the monitor to generate one.', 'error');
      return;
    }
    const url = `${window.location.origin}/public/status/${encodeURIComponent(token)}`;
    navigator.clipboard?.writeText(url).then(
      () => showToast('Public status link copied to clipboard', 'success'),
      () => showToast(url, 'info')
    );
  }

  function renderStatusBadge(w: WebsiteDTO) {
    if (w.paused) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
          PAUSED
        </span>
      );
    }
    if (!w.lastCheckedAt) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
          PENDING
        </span>
      );
    }
    if (w.isDown) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-300 whitespace-nowrap">
          DOWN ({w.consecutiveFailures} fails)
        </span>
      );
    }
    if (w.consecutiveFailures > 0) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 whitespace-nowrap">
          RETRY ({w.consecutiveFailures}/{w.failureThreshold})
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 whitespace-nowrap">
        UP
      </span>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Websites &amp; Uptime Monitoring
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Server-side HTTP(S) probes, TLS certificate expiry alerts, incident timelines, and client status pages
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleCheckAll}
            disabled={checkingAll}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checkingAll ? 'animate-spin' : ''}`} />
            Check All Now
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700 whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Website
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Monitored Websites</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {summary.total}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {summary.up} up · {summary.paused} paused
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Sites Down</p>
          <p
            className={`mt-1.5 text-2xl font-bold font-mono tabular-nums ${
              summary.down > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {summary.down}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {summary.down > 0 ? 'Active outages detected' : 'All active endpoints reachable'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">30-Day Avg Uptime</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {summary.avgUptime30d !== null ? `${summary.avgUptime30d.toFixed(2)}%` : '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Rolling 30-day check ratio</p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">SSL Expiring &le; 14d</p>
          <p
            className={`mt-1.5 text-2xl font-bold font-mono tabular-nums ${
              summary.sslExpiring14 > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {summary.sslExpiring14}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Alerts sent at 30 / 14 / 7d</p>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1">
          {(['ALL', 'UP', 'DOWN', 'PAUSED'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                statusFilter === tab
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {tab === 'ALL' ? 'All Monitors' : tab}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by website, URL, client..."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pl-8 pr-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading monitored websites...</div>
        ) : websites.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Activity className="h-8 w-8 text-slate-400 mx-auto" />
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">No websites monitored yet</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Add a client&apos;s website URL to monitor HTTP status, keyword presence, TLS certificate expiry, and share a public status page.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700"
              >
                <Plus className="h-3.5 w-3.5" /> Add First Website
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Website</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Recent Heartbeat</th>
                  <th className="px-4 py-3 font-medium text-right">Latency</th>
                  <th className="px-4 py-3 font-medium text-right">24h / 30d</th>
                  <th className="px-4 py-3 font-medium">SSL Expiry</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {websites.map((w) => {
                  const sslDays = w.sslExpiry ? getDaysLeftIST(w.sslExpiry) : null;
                  const bars = [...(w.recentChecks || [])].slice(0, 14).reverse();

                  return (
                    <tr key={w.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          <button
                            type="button"
                            onClick={() => openDetail(w)}
                            className="hover:text-sky-600 dark:hover:text-sky-400 text-left"
                          >
                            {w.label || w.url}
                          </button>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-mono text-slate-500 dark:text-slate-400">
                          <a
                            href={w.url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline truncate max-w-[240px]"
                          >
                            {w.url}
                          </a>
                          <span className="text-[10px] text-slate-400">· {w.intervalMinutes}m</span>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-xs">
                        {w.client ? (
                          <button
                            type="button"
                            onClick={() => onOpenClient(w.client!.id)}
                            className="font-medium text-slate-700 dark:text-slate-300 hover:text-sky-600 dark:hover:text-sky-400 text-left"
                          >
                            {w.client.name}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>

                      <td className="px-4 py-3">{renderStatusBadge(w)}</td>

                      <td className="px-4 py-3">
                        {bars.length === 0 ? (
                          <span className="text-xs text-slate-400">No checks yet</span>
                        ) : (
                          <div className="flex items-center gap-0.5" title="Recent checks (oldest to newest)">
                            {bars.map((c) => (
                              <span
                                key={c.id}
                                title={`${formatTimestampShort(c.checkedAt)} · ${c.up ? 'UP' : 'DOWN'}${c.responseMs ? ` (${c.responseMs}ms)` : ''}${c.error ? ` — ${c.error}` : ''}`}
                                className={`inline-block h-4 w-1.5 rounded-sm ${
                                  c.up ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-red-500 dark:bg-red-400'
                                }`}
                              />
                            ))}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                        {w.lastResponseMs !== null && w.lastResponseMs !== undefined
                          ? `${w.lastResponseMs} ms`
                          : '—'}
                      </td>

                      <td className="px-4 py-3 text-right font-mono tabular-nums text-xs">
                        <div className="text-slate-900 dark:text-slate-100">
                          {w.uptime24h !== null && w.uptime24h !== undefined ? `${w.uptime24h.toFixed(1)}%` : '—'}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          30d: {w.uptime30d !== null && w.uptime30d !== undefined ? `${w.uptime30d.toFixed(1)}%` : '—'}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-xs font-mono tabular-nums">
                        {w.sslExpiry ? (
                          <div>
                            <div
                              className={
                                sslDays !== null && sslDays <= 14
                                  ? 'font-semibold text-amber-600 dark:text-amber-400'
                                  : 'text-slate-700 dark:text-slate-300'
                              }
                            >
                              {formatDateDDMMMYYYY(w.sslExpiry)}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {sslDays !== null ? `${sslDays}d left` : ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleCheckOne(w)}
                            disabled={checkingId === w.id}
                            title="Run check now"
                            className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${checkingId === w.id ? 'animate-spin' : ''}`} />
                          </button>

                          <button
                            type="button"
                            onClick={() => copyPublicStatusUrl(w.publicStatusToken)}
                            title="Copy public status page link"
                            className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>

                          {w.publicStatusToken && (
                            <a
                              href={`/public/status/${encodeURIComponent(w.publicStatusToken)}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Open public status page"
                              className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}

                          <button
                            type="button"
                            onClick={() => handleTogglePause(w)}
                            title={w.paused ? 'Resume monitoring' : 'Pause monitoring'}
                            className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            {w.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                          </button>

                          <button
                            type="button"
                            onClick={() => openEditModal(w)}
                            title="Edit monitor"
                            className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>

                          {confirmDeleteId === w.id ? (
                            <button
                              type="button"
                              onClick={() => handleDelete(w.id)}
                              className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700 whitespace-nowrap"
                            >
                              Confirm
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(w.id)}
                              title="Delete monitor"
                              className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {form.id ? 'Edit Website Monitor' : 'Add Website Monitor'}
              </h2>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveForm} className="p-5 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Website URL (HTTP or HTTPS) *
                  </label>
                  <input
                    type="url"
                    required
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    placeholder="https://clientdomain.com"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Display Label
                  </label>
                  <input
                    type="text"
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                    placeholder="Client Production Site"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Client *
                  </label>
                  <select
                    required
                    value={form.clientId}
                    onChange={(e) => setForm({ ...form, clientId: e.target.value, domainId: '' })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="">Select client...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.company ? `(${c.company})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Linked Domain (Optional)
                  </label>
                  <select
                    value={form.domainId}
                    onChange={(e) => setForm({ ...form, domainId: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="">None</option>
                    {clientDomains.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Check Interval
                  </label>
                  <select
                    value={form.intervalMinutes}
                    onChange={(e) => setForm({ ...form, intervalMinutes: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value={1}>Every 1 minute</option>
                    <option value={5}>Every 5 minutes</option>
                    <option value={15}>Every 15 minutes</option>
                    <option value={30}>Every 30 minutes</option>
                    <option value={60}>Every 60 minutes</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Expected HTTP Code
                  </label>
                  <input
                    type="number"
                    min={100}
                    max={599}
                    value={form.expectedStatusCode}
                    onChange={(e) => setForm({ ...form, expectedStatusCode: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Failure Threshold (before alert)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={form.failureThreshold}
                    onChange={(e) => setForm({ ...form, failureThreshold: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Timeout (ms)
                  </label>
                  <input
                    type="number"
                    min={1000}
                    max={30000}
                    step={500}
                    value={form.timeoutMs}
                    onChange={(e) => setForm({ ...form, timeoutMs: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Required Keyword (Optional)
                  </label>
                  <input
                    type="text"
                    value={form.requiredKeyword}
                    onChange={(e) => setForm({ ...form, requiredKeyword: e.target.value })}
                    placeholder="e.g. Welcome"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Extra Alert Emails (comma-separated, optional)
                  </label>
                  <input
                    type="text"
                    value={form.alertContactsText}
                    onChange={(e) => setForm({ ...form, alertContactsText: e.target.value })}
                    placeholder="ops@aligarhwebsolutions.com"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="sm:col-span-2 flex flex-wrap gap-5 pt-1">
                  <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={form.notifyClient}
                      onChange={(e) => setForm({ ...form, notifyClient: e.target.checked })}
                      className="rounded border-slate-300"
                    />
                    Also notify client on outage &amp; recovery
                  </label>
                  <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={form.paused}
                      onChange={(e) => setForm({ ...form, paused: e.target.checked })}
                      className="rounded border-slate-300"
                    />
                    Start paused
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : form.id ? 'Save Changes' : 'Create Monitor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail / Incidents / Check History Modal */}
      {detailSite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60">
          <div className="w-full max-w-3xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {detailSite.label || detailSite.url}
                  </h2>
                  {renderStatusBadge(detailSite)}
                </div>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                  {detailSite.url} · Expected HTTP {detailSite.expectedStatusCode} · Interval {detailSite.intervalMinutes}m
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCheckOne(detailSite)}
                  disabled={checkingId === detailSite.id}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${checkingId === detailSite.id ? 'animate-spin' : ''}`} />
                  Check Now
                </button>
                <button
                  type="button"
                  onClick={() => setDetailSite(null)}
                  className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 text-xs">
              {/* Public Status Share Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 px-4 py-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    Public Client Status Page
                  </span>
                  {detailSite.sslExpiry && (
                    <span className="font-mono text-slate-500 dark:text-slate-400">
                      · SSL expires {formatDateDDMMMYYYY(detailSite.sslExpiry)} ({getDaysLeftIST(detailSite.sslExpiry)}d)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => copyPublicStatusUrl(detailSite.publicStatusToken)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Copy className="h-3 w-3" /> Copy Link
                  </button>
                  {detailSite.publicStatusToken && (
                    <a
                      href={`/public/status/${encodeURIComponent(detailSite.publicStatusToken)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700"
                    >
                      <ExternalLink className="h-3 w-3" /> Open Page
                    </a>
                  )}
                </div>
              </div>

              {/* Incident Timeline */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Incident History ({detailSite.incidents?.length || 0})
                </h3>
                {loadingDetail ? (
                  <p className="text-slate-500">Loading incident logs...</p>
                ) : !detailSite.incidents || detailSite.incidents.length === 0 ? (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 flex items-center gap-2 text-emerald-700 dark:text-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20">
                    <CheckCircle2 className="h-4 w-4" />
                    No downtime incidents recorded for this website.
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                    {detailSite.incidents.map((inc) => (
                      <div key={inc.id} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                            {inc.endedAt ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                            )}
                            <span>{inc.endedAt ? 'Resolved Incident' : 'Active Outage'}</span>
                            <span className="font-mono text-slate-500">
                              ({formatDuration(inc.durationSeconds)})
                            </span>
                          </div>
                          {inc.errorSummary && (
                            <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {inc.errorSummary}
                            </p>
                          )}
                        </div>
                        <div className="text-right font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                          <div>Started: {formatTimestampShort(inc.startedAt)}</div>
                          {inc.endedAt && <div>Ended: {formatTimestampShort(inc.endedAt)}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Checks Table */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Recent Probes ({detailSite.recentChecks?.length || 0})
                </h3>
                {!detailSite.recentChecks || detailSite.recentChecks.length === 0 ? (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 text-slate-500 flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    No checks run yet. Click &ldquo;Check Now&rdquo; to trigger an immediate probe.
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden max-h-64 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="px-3 py-2 font-medium">Time (IST)</th>
                          <th className="px-3 py-2 font-medium">Result</th>
                          <th className="px-3 py-2 font-medium text-right">HTTP</th>
                          <th className="px-3 py-2 font-medium text-right">Latency</th>
                          <th className="px-3 py-2 font-medium">Detail</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {detailSite.recentChecks.map((c) => (
                          <tr key={c.id}>
                            <td className="px-3 py-2 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                              {formatTimestampShort(c.checkedAt)}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`font-semibold ${
                                  c.up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                                }`}
                              >
                                {c.up ? 'UP' : 'DOWN'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                              {c.httpCode ?? '—'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                              {c.responseMs !== null && c.responseMs !== undefined ? `${c.responseMs} ms` : '—'}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[240px]">
                              {c.error || 'OK'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
