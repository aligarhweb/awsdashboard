import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, PauseCircle, RefreshCw, ShieldCheck, ExternalLink } from 'lucide-react';
import { PublicStatusDTO } from '../../shared/types';
import { formatDateDDMMMYYYY, getDaysLeftIST } from '../../shared/dates';

interface PublicStatusPageProps {
  token: string;
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

function formatTimeIst(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PublicStatusPage({ token }: PublicStatusPageProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PublicStatusDTO | null>(null);

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/status/${encodeURIComponent(token)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Status page unavailable');
      setData(json);
    } catch (err: any) {
      setError(err.message || 'Could not load status page');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-sm text-slate-500">Loading service status...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-xl border border-slate-200 bg-white p-8 text-center">
          <h1 className="text-lg font-bold text-slate-900">Status Page Unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{error || 'This public status link is invalid or expired.'}</p>
        </div>
      </div>
    );
  }

  const bannerConfig =
    data.overallStatus === 'DOWN'
      ? {
          bg: 'bg-red-50 border-red-200 text-red-900',
          icon: <AlertTriangle className="h-5 w-5 text-red-600" />,
          label: 'Major Outage Detected',
        }
      : data.overallStatus === 'DEGRADED'
        ? {
            bg: 'bg-amber-50 border-amber-200 text-amber-900',
            icon: <AlertTriangle className="h-5 w-5 text-amber-600" />,
            label: 'Partial Service Disruption',
          }
        : data.overallStatus === 'PAUSED'
          ? {
              bg: 'bg-slate-100 border-slate-200 text-slate-800',
              icon: <PauseCircle className="h-5 w-5 text-slate-500" />,
              label: 'Monitoring Paused',
            }
          : {
              bg: 'bg-emerald-50 border-emerald-200 text-emerald-900',
              icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
              label: 'All Systems Operational',
            };

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-sky-700">
              {data.business.businessName} · Status Monitor
            </p>
            <h1 className="text-xl font-bold text-slate-900 mt-0.5">{data.title}</h1>
            {data.subtitle && <p className="text-xs text-slate-600">{data.subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={loadStatus}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        {/* Overall Status Banner */}
        <div className={`rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3 ${bannerConfig.bg}`}>
          <div className="flex items-center gap-2.5">
            {bannerConfig.icon}
            <span className="text-sm font-bold">{bannerConfig.label}</span>
          </div>
          <span className="text-xs font-mono opacity-80">
            Updated {formatTimeIst(data.generatedAt)} IST
          </span>
        </div>

        {/* Monitored Properties */}
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
          {data.websites.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">No active endpoints configured.</div>
          ) : (
            data.websites.map((w) => {
              const bars = [...w.recentChecks].slice(0, 30).reverse();
              const sslDays = w.sslExpiry ? getDaysLeftIST(w.sslExpiry) : null;
              return (
                <div key={w.id} className="p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-slate-900">{w.label}</span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-semibold border ${
                            w.status === 'UP'
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                              : w.status === 'DOWN'
                                ? 'bg-red-50 border-red-200 text-red-700'
                                : 'bg-slate-100 border-slate-200 text-slate-600'
                          }`}
                        >
                          {w.status}
                        </span>
                      </div>
                      <a
                        href={w.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-mono text-slate-500 hover:underline mt-0.5"
                      >
                        {w.url}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>

                    <div className="flex items-center gap-4 text-right font-mono tabular-nums text-xs">
                      <div>
                        <div className="text-slate-400 text-[11px]">24h</div>
                        <div className="font-semibold text-slate-900">
                          {w.uptime24h !== null ? `${w.uptime24h.toFixed(2)}%` : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[11px]">30d</div>
                        <div className="font-semibold text-slate-900">
                          {w.uptime30d !== null ? `${w.uptime30d.toFixed(2)}%` : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[11px]">Latency</div>
                        <div className="font-semibold text-slate-900">
                          {w.lastResponseMs !== null ? `${w.lastResponseMs} ms` : '—'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Uptime Bars */}
                  <div className="flex items-center gap-1">
                    {bars.length === 0 ? (
                      <span className="text-xs text-slate-400">Awaiting first check</span>
                    ) : (
                      bars.map((c, idx) => (
                        <span
                          key={`${c.checkedAt}-${idx}`}
                          title={`${formatTimeIst(c.checkedAt)} · ${c.up ? 'Operational' : 'Down'}${c.responseMs ? ` (${c.responseMs}ms)` : ''}`}
                          className={`h-5 flex-1 max-w-[14px] rounded-sm ${
                            c.up ? 'bg-emerald-500' : 'bg-red-500'
                          }`}
                        />
                      ))
                    )}
                  </div>

                  {w.sslExpiry && (
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-500">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                      TLS Certificate valid until {formatDateDDMMMYYYY(w.sslExpiry)}
                      {sslDays !== null ? ` (${sslDays} days remaining)` : ''}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Recent Incidents */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Recent Incident Log
          </div>
          {data.incidents.length === 0 ? (
            <div className="p-5 text-xs text-slate-500">No incidents recorded in the last 30 days.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.incidents.map((inc) => (
                <div key={inc.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="font-semibold text-slate-900">{inc.websiteLabel}</span>
                    <span className="mx-2 text-slate-300">·</span>
                    <span className={inc.status === 'OPEN' ? 'font-semibold text-red-600' : 'text-emerald-700'}>
                      {inc.status === 'OPEN' ? 'Ongoing Outage' : `Resolved (${formatDuration(inc.durationSeconds)})`}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-slate-500">
                    {formatTimeIst(inc.startedAt)} IST
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {data.business.email && (
          <p className="text-center text-xs text-slate-500">
            Managed by {data.business.businessName} · Support: {data.business.email}
          </p>
        )}
      </div>
    </div>
  );
}
