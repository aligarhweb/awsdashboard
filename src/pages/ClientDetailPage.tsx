import React, { useEffect, useState } from 'react';
import { ArrowLeft, Plus, CheckSquare, Globe, Server, Receipt } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { InvoiceDTO } from '../../shared/types';
import { formatDateDDMMMYYYY } from '../../shared/dates';
import { formatINR } from '../../shared/currency';
import { UrgencyTag } from '../components/UrgencyTag';
import { useToast } from '../components/Toast';

interface ClientDetailPageProps {
  clientId: string;
  onBack: () => void;
  onNavigate: (route: string) => void;
}

export function ClientDetailPage({ clientId, onBack, onNavigate }: ClientDetailPageProps) {
  const { showToast } = useToast();
  const [client, setClient] = useState<any | null>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [clientInvoices, setClientInvoices] = useState<InvoiceDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskTitle, setTaskTitle] = useState('');
  const [addingTask, setAddingTask] = useState(false);

  async function loadDetail() {
    setLoading(true);
    try {
      const [res, invRes] = await Promise.all([
        apiRequest<{ client: any; timeline: any[] }>(`/api/clients/${clientId}`),
        apiRequest<{ items: InvoiceDTO[] }>(`/api/invoices?clientId=${encodeURIComponent(clientId)}`),
      ]);
      setClient(res.client);
      setTimeline(res.timeline);
      setClientInvoices(invRes.items || []);
    } catch (err: any) {
      showToast(err.message || 'Could not load client detail', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDetail();
  }, [clientId]);

  async function toggleReminders() {
    if (!client) return;
    try {
      await apiRequest(`/api/clients/${client.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ remindersEnabled: !client.remindersEnabled }),
      });
      showToast(
        !client.remindersEnabled ? 'Reminders enabled for client' : 'Reminders paused for client',
        'success'
      );
      loadDetail();
    } catch (err: any) {
      showToast(err.message || 'Update failed', 'error');
    }
  }

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    setAddingTask(true);
    try {
      await apiRequest('/api/settings/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: taskTitle.trim(),
          clientId,
          dueDate: new Date().toISOString(),
        }),
      });
      setTaskTitle('');
      showToast('Follow-up task added', 'success');
      loadDetail();
    } catch (err: any) {
      showToast(err.message || 'Could not add task', 'error');
    } finally {
      setAddingTask(false);
    }
  }

  async function handleDoneTask(id: string) {
    try {
      await apiRequest(`/api/settings/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'DONE' }),
      });
      loadDetail();
    } catch (err: any) {
      showToast(err.message || 'Could not update task', 'error');
    }
  }

  async function handleBillRenewal(kind: 'DOMAIN' | 'SERVICE', id: string) {
    try {
      const res = await apiRequest<{ invoice: { id: string; invoiceNumber: string } }>('/api/invoices/from-renewal', {
        method: 'POST',
        body: JSON.stringify({ kind, id }),
      });
      showToast(`Created draft renewal invoice ${res.invoice.invoiceNumber}`, 'success');
      onNavigate(`invoices?id=${res.invoice.id}`);
    } catch (err: any) {
      showToast(err.message || 'Could not generate renewal invoice', 'error');
    }
  }

  if (loading) {
    return <div className="h-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />;
  }

  if (!client) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
        <p className="text-sm text-slate-600 dark:text-slate-400">Client record not found.</p>
        <button type="button" onClick={onBack} className="mt-3 text-xs text-sky-600 hover:underline">
          Back to Clients
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 mb-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Clients
          </button>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {client.name}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {client.company || 'Individual / Proprietorship'}
            {client.state ? ` · ${client.state}` : ''}
            {client.gstin ? ` · GSTIN ${client.gstin}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={toggleReminders}
            className={`rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors ${
              client.remindersEnabled
                ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
            }`}
          >
            {client.remindersEnabled ? 'Reminders Enabled' : 'Reminders Paused'}
          </button>
          <button
            type="button"
            onClick={() => onNavigate('domains')}
            className="rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-700"
          >
            Manage Domains
          </button>
        </div>
      </div>

      {/* Contact & Summary Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2 text-xs">
          <p className="font-semibold text-slate-900 dark:text-slate-100 text-sm">Contact Details</p>
          <p className="text-slate-600 dark:text-slate-400">
            Person: <span className="text-slate-900 dark:text-slate-200">{client.contactPerson || '—'}</span>
          </p>
          <p className="text-slate-600 dark:text-slate-400">
            Emails: <span className="text-slate-900 dark:text-slate-200">{client.emails?.join(', ') || '—'}</span>
          </p>
          <p className="text-slate-600 dark:text-slate-400">
            WhatsApp: <span className="font-mono text-slate-900 dark:text-slate-200">{client.whatsappPhone || '—'}</span>
          </p>
          <p className="text-slate-600 dark:text-slate-400">
            Preferred Channel: <span className="text-slate-900 dark:text-slate-200">{client.preferredChannel}</span>
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2 text-xs">
          <p className="font-semibold text-slate-900 dark:text-slate-100 text-sm">Address &amp; Notes</p>
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed">{client.address || 'No address saved'}</p>
          {client.notes && (
            <p className="pt-2 border-t border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-400 leading-relaxed">
              {client.notes}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2 text-xs">
          <p className="font-semibold text-slate-900 dark:text-slate-100 text-sm">Portfolio Snapshot</p>
          <div className="flex justify-between">
            <span className="text-slate-500">Tracked Domains</span>
            <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{client.domains?.length ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Recurring Services</span>
            <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{client.services?.length ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Outstanding Invoices</span>
            <button
              type="button"
              onClick={() => onNavigate('invoices')}
              className="font-mono font-semibold text-amber-600 dark:text-amber-400 hover:underline"
            >
              {formatINR(
                clientInvoices
                  .filter((i) => !['DRAFT', 'CANCELLED', 'PAID'].includes(i.status))
                  .reduce((s, i) => s + Number(i.balanceDue || 0), 0),
                { decimals: 2 }
              )}
            </button>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Messages Sent / Replies</span>
            <button
              type="button"
              onClick={() => onNavigate('messages')}
              className="font-mono font-semibold text-sky-600 dark:text-sky-400 hover:underline tabular-nums"
            >
              {client.messagesSent ?? 0} / {client.inboundReplies ?? 0}
            </button>
          </div>
        </div>
      </div>

      {/* Domains */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 px-5 py-3">
          <Globe className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Domains</h2>
        </div>
        {client.domains?.length === 0 ? (
          <p className="p-5 text-xs text-slate-500 dark:text-slate-400">No domains linked to this client.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-2 font-medium">Domain</th>
                <th className="px-4 py-2 font-medium">Provider</th>
                <th className="px-4 py-2 font-medium">Expiry</th>
                <th className="px-4 py-2 font-medium text-right">Sell Price</th>
                <th className="px-4 py-2 font-medium text-right">Urgency</th>
                <th className="px-4 py-2 font-medium text-right">Bill</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {client.domains.map((d: any) => (
                <tr key={d.id}>
                  <td className="px-4 py-2.5 font-mono text-xs font-medium text-slate-900 dark:text-slate-100">{d.name}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400">{d.providerAccount?.name || 'Manual'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-700 dark:text-slate-300">{formatDateDDMMMYYYY(d.expiryDate)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">{formatINR(d.sellingPrice)}</td>
                  <td className="px-4 py-2.5 text-right"><UrgencyTag targetDate={d.expiryDate} /></td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => handleBillRenewal('DOMAIN', d.id)}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:border-sky-500 hover:text-sky-600 whitespace-nowrap"
                    >
                      <Receipt className="h-3 w-3" /> Bill Renewal
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Services */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 px-5 py-3">
          <Server className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Hosting &amp; Services</h2>
        </div>
        {client.services?.length === 0 ? (
          <p className="p-5 text-xs text-slate-500 dark:text-slate-400">No services linked to this client.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-2 font-medium">Plan</th>
                <th className="px-4 py-2 font-medium">Type / Cycle</th>
                <th className="px-4 py-2 font-medium">Renewal Date</th>
                <th className="px-4 py-2 font-medium text-right">Sell Price</th>
                <th className="px-4 py-2 font-medium text-right">Urgency</th>
                <th className="px-4 py-2 font-medium text-right">Bill</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {client.services.map((s: any) => (
                <tr key={s.id}>
                  <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">{s.planName}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400">
                    {s.type.replace('_', ' ')} · {s.billingCycle}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-700 dark:text-slate-300">{formatDateDDMMMYYYY(s.renewalDate)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">{formatINR(s.sellingPrice)}</td>
                  <td className="px-4 py-2.5 text-right"><UrgencyTag targetDate={s.renewalDate} /></td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => handleBillRenewal('SERVICE', s.id)}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:border-sky-500 hover:text-sky-600 whitespace-nowrap"
                    >
                      <Receipt className="h-3 w-3" /> Bill Renewal
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Tasks & Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Follow-up Tasks</h2>
          <form onSubmit={handleAddTask} className="flex gap-2">
            <input
              type="text"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="Add follow-up note or call reminder..."
              className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs"
            />
            <button
              type="submit"
              disabled={addingTask || !taskTitle.trim()}
              className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </form>
          <div className="space-y-2">
            {(client.tasks || []).length === 0 ? (
              <p className="text-xs text-slate-500">No tasks recorded.</p>
            ) : (
              client.tasks.map((t: any) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2 text-xs"
                >
                  <span className={t.status === 'DONE' ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'}>
                    {t.title}
                  </span>
                  {t.status !== 'DONE' && (
                    <button
                      type="button"
                      onClick={() => handleDoneTask(t.id)}
                      className="inline-flex items-center gap-1 text-emerald-600 hover:underline shrink-0"
                    >
                      <CheckSquare className="h-3.5 w-3.5" /> Done
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Activity Timeline</h2>
          {timeline.length === 0 ? (
            <p className="text-xs text-slate-500">No recorded events yet.</p>
          ) : (
            <div className="space-y-2.5 max-h-60 overflow-y-auto">
              {timeline.map((log: any) => (
                <div key={log.id} className="text-xs border-b border-slate-100 dark:border-slate-800 pb-2">
                  <p className="font-medium text-slate-800 dark:text-slate-200">{log.summary}</p>
                  <p className="text-slate-400 font-mono mt-0.5">
                    {formatDateDDMMMYYYY(log.createdAt)} · {log.actorEmail || 'system'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Messages & WhatsApp Replies */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Recent Messages &amp; WhatsApp Replies
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('messages')}
            className="text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline"
          >
            Open Messages Center
          </button>
        </div>
        {(client.messageLogs || []).length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No email or WhatsApp messages recorded for this client yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {client.messageLogs.map((m: any) => (
              <div key={m.id} className="py-2.5 text-xs space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                    {m.channel} · {m.direction === 'INBOUND' ? 'INBOUND REPLY' : 'OUTBOUND'} · {m.status}
                  </span>
                  <span className="font-mono text-slate-400 tabular-nums">
                    {formatDateDDMMMYYYY(m.sentAt || m.createdAt)}
                  </span>
                </div>
                {m.renderedSubject && (
                  <p className="font-medium text-slate-900 dark:text-slate-100">{m.renderedSubject}</p>
                )}
                <p className="text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{m.renderedContent}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
