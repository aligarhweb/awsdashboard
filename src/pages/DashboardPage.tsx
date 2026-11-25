import { useEffect, useMemo, useState } from 'react';
import { Calendar, List, CheckSquare, ArrowRight, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { DashboardSummaryDTO } from '../../shared/types';
import { formatDateDDMMMYYYY, getIstDateParts } from '../../shared/dates';
import { formatINR } from '../../shared/currency';
import { UrgencyTag } from '../components/UrgencyTag';
import { useToast } from '../components/Toast';

interface DashboardPageProps {
  onNavigate: (route: string) => void;
}

export function DashboardPage({ onNavigate }: DashboardPageProps) {
  const { showToast } = useToast();
  const [data, setData] = useState<DashboardSummaryDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [calendarView, setCalendarView] = useState<'list' | 'month'>('list');
  const [monthCursor, setMonthCursor] = useState(() => {
    const p = getIstDateParts(new Date());
    return { year: p.year, month: p.month - 1 }; // 0-indexed month
  });
  const [runningTick, setRunningTick] = useState(false);

  async function loadDashboard() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiRequest<DashboardSummaryDTO>('/api/dashboard');
      setData(res);
    } catch (err: any) {
      const msg = err.message || 'Failed to load dashboard';
      setLoadError(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  async function handleCompleteTask(taskId: string) {
    try {
      await apiRequest(`/api/settings/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'DONE' }),
      });
      showToast('Task marked as done', 'success');
      loadDashboard();
    } catch (err: any) {
      showToast(err.message || 'Could not update task', 'error');
    }
  }

  async function handleRunCronNow() {
    setRunningTick(true);
    try {
      await apiRequest('/api/cron/run-now', {
        method: 'POST',
        body: JSON.stringify({ forceAll: true }),
      });
      showToast('Cron jobs synced successfully', 'success');
      loadDashboard();
    } catch (err: any) {
      showToast(err.message || 'Cron run failed', 'error');
    } finally {
      setRunningTick(false);
    }
  }

  const monthDaysGrid = useMemo(() => {
    const firstDay = new Date(Date.UTC(monthCursor.year, monthCursor.month, 1));
    const startWeekday = firstDay.getUTCDay(); // 0=Sun
    const daysInMonth = new Date(Date.UTC(monthCursor.year, monthCursor.month + 1, 0)).getUTCDate();
    const cells: Array<{ day: number | null; items: DashboardSummaryDTO['upcomingCalendar'] }> = [];

    for (let i = 0; i < startWeekday; i++) cells.push({ day: null, items: [] });

    const byDay = new Map<number, DashboardSummaryDTO['upcomingCalendar']>();
    for (const item of data?.upcomingCalendar || []) {
      const parts = getIstDateParts(item.date);
      if (parts.year === monthCursor.year && parts.month - 1 === monthCursor.month) {
        const list = byDay.get(parts.day) || [];
        list.push(item);
        byDay.set(parts.day, list);
      }
    }

    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, items: byDay.get(d) || [] });
    }
    return cells;
  }, [monthCursor, data]);

  const monthLabel = new Date(Date.UTC(monthCursor.year, monthCursor.month, 1)).toLocaleString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-24 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse"
            />
          ))}
        </div>
        <div className="h-72 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 p-8 text-center max-w-lg mx-auto mt-8">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Unable to load dashboard
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {loadError || 'An unexpected error occurred while fetching dashboard metrics.'}
        </p>
        <button
          type="button"
          onClick={loadDashboard}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    );
  }

  const { counts, forecast90Days, actionNeededToday, upcomingCalendar, jobStates } = data;

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Command Dashboard
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {counts.totalClients} active clients · {counts.totalDomains} domains · {counts.totalServices} recurring services
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleRunCronNow}
            disabled={runningTick}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${runningTick ? 'animate-spin' : ''}`} />
            Sync Expiry Status
          </button>
          <button
            type="button"
            onClick={() => onNavigate('domains')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700 whitespace-nowrap shrink-0"
          >
            View All Domains
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <button
          type="button"
          onClick={() => onNavigate('domains?window=expired')}
          className="text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-red-300 dark:hover:border-red-800 transition-colors"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Expired Items</p>
          <p className={`mt-1.5 text-2xl font-bold font-mono tabular-nums ${counts.expiredItems > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
            {counts.expiredItems}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Domains &amp; services overdue</p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('domains?window=7')}
          className="text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-red-300 dark:hover:border-red-800 transition-colors"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Expiring in 7 Days</p>
          <p className={`mt-1.5 text-2xl font-bold font-mono tabular-nums ${counts.domainsExpiring7 > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
            {counts.domainsExpiring7}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Immediate renewal window</p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('domains?window=30')}
          className="text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-orange-300 dark:hover:border-orange-800 transition-colors"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Expiring in 30 Days</p>
          <p className={`mt-1.5 text-2xl font-bold font-mono tabular-nums ${counts.domainsExpiring30 > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-slate-900 dark:text-slate-100'}`}>
            {counts.domainsExpiring30}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">30-day domain queue</p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('domains?window=60')}
          className="text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-amber-300 dark:hover:border-amber-800 transition-colors"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Expiring in 60 Days</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
            {counts.domainsExpiring60}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Upcoming 60-day pipeline</p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('services?window=30')}
          className="text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Services This Month</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {counts.servicesRenewingThisMonth}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Hosting, Email &amp; AMC renewals</p>
        </button>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">90-Day Renewal Revenue</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {formatINR(forecast90Days.totalRevenue)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {forecast90Days.itemsCount} items scheduled
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">90-Day Est. Profit</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            {formatINR(forecast90Days.totalProfit)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Selling minus provider cost</p>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('invoices')}
          className="text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-sky-300 dark:hover:border-sky-800 transition-colors"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Unpaid Invoices</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {formatINR(counts.unpaidInvoicesTotal)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            FY Collected: {formatINR(counts.revenueThisFy)}
          </p>
        </button>
      </div>

      {/* Live Website Uptime Strip */}
      <button
        type="button"
        onClick={() => onNavigate('uptime')}
        className="w-full text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3 flex flex-wrap items-center justify-between gap-3 hover:border-sky-300 dark:hover:border-sky-800 transition-colors"
      >
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="font-semibold text-slate-900 dark:text-slate-100">Website Uptime Monitor</span>
          <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
          <span
            className={`font-mono font-semibold tabular-nums ${
              counts.sitesDownCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {counts.sitesDownCount} sites down
          </span>
          <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
          <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
            30d Avg Uptime:{' '}
            <strong className="text-slate-900 dark:text-slate-100">
              {counts.uptime30dAvg !== null ? `${counts.uptime30dAvg.toFixed(2)}%` : 'No checks yet'}
            </strong>
          </span>
        </div>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 dark:text-sky-400">
          Open Uptime Monitors <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </button>

      {/* Main Two-Column Grid: Action Needed Today + 90-Day Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Action Needed Today
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Expired items, renewals within 7 days, and open follow-up tasks
              </p>
            </div>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {actionNeededToday.length} items
            </span>
          </div>

          {actionNeededToday.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                All clear for today
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                No expired items or domains/services expiring within the next 7 days.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {actionNeededToday.map((item) => (
                <div
                  key={`${item.kind}-${item.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                        {item.kind}
                      </span>
                      <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                      {item.kind === 'INVOICE' ? (
                        <button
                          type="button"
                          onClick={() => onNavigate(`invoices?id=${item.id}`)}
                          className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:text-sky-600 dark:hover:text-sky-400 truncate"
                        >
                          {item.title}
                        </button>
                      ) : item.clientId ? (
                        <button
                          type="button"
                          onClick={() => onNavigate(`clients/${item.clientId}`)}
                          className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:text-sky-600 dark:hover:text-sky-400 truncate"
                        >
                          {item.title}
                        </button>
                      ) : (
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {item.title}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                      {item.clientName ? `${item.clientName} · ` : ''}
                      {item.subtitle} · Due {formatDateDDMMMYYYY(item.dueDate)}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {typeof item.amount === 'number' && item.amount > 0 && (
                      <span className="font-mono text-xs font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                        {formatINR(item.amount)}
                      </span>
                    )}
                    <UrgencyTag targetDate={item.dueDate} />
                    {item.kind === 'TASK' && (
                      <button
                        type="button"
                        onClick={() => handleCompleteTask(item.id)}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <CheckSquare className="h-3.5 w-3.5" /> Done
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 90-Day Forecast + Cron Status */}
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              90-Day Renewal Margin
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Expected renewal billing vs. registrar &amp; hosting cost
            </p>

            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Domain Renewals</span>
                <span className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                  {formatINR(forecast90Days.domainRevenue)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-500">Domain Cost</span>
                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  − {formatINR(forecast90Days.domainCost)}
                </span>
              </div>
              <div className="border-t border-slate-100 dark:border-slate-800 pt-2.5 flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Service Renewals</span>
                <span className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                  {formatINR(forecast90Days.serviceRevenue)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-500">Service Cost</span>
                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  − {formatINR(forecast90Days.serviceCost)}
                </span>
              </div>
              <div className="border-t border-slate-200 dark:border-slate-800 pt-3 flex items-center justify-between font-semibold">
                <span className="text-slate-900 dark:text-slate-100">Projected Net Profit</span>
                <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatINR(forecast90Days.totalProfit)}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Scheduled Jobs
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('settings?tab=cron')}
                className="text-xs text-sky-600 dark:text-sky-400 hover:underline"
              >
                Configure
              </button>
            </div>
            {jobStates.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                No cron tick executed yet. Click &ldquo;Sync Expiry Status&rdquo; above or configure the hPanel cron job.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {jobStates.slice(0, 4).map((j) => (
                  <div key={j.jobName} className="flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-700 dark:text-slate-300 truncate max-w-[160px]">
                      {j.jobName}
                    </span>
                    <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                      {j.lastRunAt ? formatDateDDMMMYYYY(j.lastRunAt) : 'Pending'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Renewal Calendar (List + Month View) */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Renewal Calendar (Next 90 Days)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              All upcoming domain and hosting renewals sorted in Asia/Kolkata time
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
            <button
              type="button"
              onClick={() => setCalendarView('list')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                calendarView === 'list'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <List className="h-3.5 w-3.5" />
              List
            </button>
            <button
              type="button"
              onClick={() => setCalendarView('month')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                calendarView === 'month'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Calendar className="h-3.5 w-3.5" />
              Month
            </button>
          </div>
        </div>

        {calendarView === 'list' ? (
          upcomingCalendar.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No renewals scheduled in the next 90 days.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Renewal Date</th>
                    <th className="px-5 py-2.5 font-medium">Item</th>
                    <th className="px-5 py-2.5 font-medium">Client</th>
                    <th className="px-5 py-2.5 font-medium">Provider</th>
                    <th className="px-5 py-2.5 font-medium text-right">Sell Price</th>
                    <th className="px-5 py-2.5 font-medium text-right">Urgency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {upcomingCalendar.map((item) => (
                    <tr key={`${item.kind}-${item.id}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-5 py-2.5 font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                        {formatDateDDMMMYYYY(item.date)}
                      </td>
                      <td className="px-5 py-2.5">
                        <span className="font-medium text-slate-900 dark:text-slate-100">{item.name}</span>
                        <span className="ml-2 text-xs text-slate-400 font-mono">
                          {item.kind === 'DOMAIN' ? 'Domain' : 'Service'}
                          {item.autoRenew ? ' · Auto-renew' : ''}
                        </span>
                      </td>
                      <td className="px-5 py-2.5">
                        <button
                          type="button"
                          onClick={() => onNavigate(`clients/${item.clientId}`)}
                          className="text-slate-700 dark:text-slate-300 hover:text-sky-600 dark:hover:text-sky-400"
                        >
                          {item.clientName}
                        </button>
                      </td>
                      <td className="px-5 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                        {item.providerName || 'Manual'}
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono text-xs tabular-nums text-slate-900 dark:text-slate-100">
                        {formatINR(item.sellingPrice)}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <UrgencyTag targetDate={item.date} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{monthLabel}</h3>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setMonthCursor((c) =>
                      c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }
                    )
                  }
                  className="rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setMonthCursor((c) =>
                      c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }
                    )
                  }
                  className="rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  aria-label="Next month"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-px rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-200 dark:bg-slate-800 overflow-hidden text-xs">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div
                  key={d}
                  className="bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-center font-medium text-slate-500 dark:text-slate-400"
                >
                  {d}
                </div>
              ))}
              {monthDaysGrid.map((cell, idx) => (
                <div
                  key={idx}
                  className="min-h-[84px] bg-white dark:bg-slate-900 p-1.5 flex flex-col gap-1"
                >
                  {cell.day !== null && (
                    <>
                      <span className="font-mono text-[11px] text-slate-400 tabular-nums">{cell.day}</span>
                      {cell.items.map((ev) => (
                        <button
                          key={`${ev.kind}-${ev.id}`}
                          type="button"
                          onClick={() => onNavigate(`clients/${ev.clientId}`)}
                          title={`${ev.name} (${ev.clientName}) — ${formatINR(ev.sellingPrice)}`}
                          className={`truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium ${
                            ev.urgency === 'red'
                              ? 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                              : ev.urgency === 'orange'
                                ? 'bg-orange-50 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300'
                                : ev.urgency === 'yellow'
                                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                  : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                          }`}
                        >
                          {ev.name}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
