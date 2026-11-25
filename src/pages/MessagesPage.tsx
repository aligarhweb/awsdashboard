import React, { useEffect, useMemo, useState } from 'react';
import {
  Send,
  Play,
  RefreshCw,
  Plus,
  Edit2,
  Trash2,
  Eye,
  SkipForward,
  Check,
  X,
  Mail,
  MessageSquare,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  ClientDTO,
  EstimateDTO,
  InvoiceDTO,
  MessageChannel,
  MessageLogDTO,
  MessageStatus,
  MessageTemplateDTO,
  ReminderItemType,
  ReminderRuleDTO,
} from '../../shared/types';
import { formatDateDDMMMYYYY } from '../../shared/dates';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface MessagesPageProps {
  onOpenClient: (clientId: string) => void;
}

type SubTab = 'logs' | 'rules' | 'templates';

const TEMPLATE_VARS = [
  '{{client_name}}',
  '{{business_name}}',
  '{{domain}}',
  '{{expiry_date}}',
  '{{days_left}}',
  '{{amount}}',
  '{{invoice_no}}',
  '{{pay_link}}',
];

function statusTextClass(status: MessageStatus): string {
  switch (status) {
    case 'SENT':
    case 'DELIVERED':
    case 'READ':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'QUEUED':
      return 'text-sky-700 dark:text-sky-400';
    case 'FAILED':
      return 'text-red-700 dark:text-red-400';
    case 'SKIPPED':
      return 'text-slate-500 dark:text-slate-400';
    default:
      return 'text-slate-600 dark:text-slate-300';
  }
}

export function MessagesPage({ onOpenClient }: MessagesPageProps) {
  const { showToast } = useToast();
  const [subTab, setSubTab] = useState<SubTab>('logs');
  const [loading, setLoading] = useState(true);

  const [logs, setLogs] = useState<MessageLogDTO[]>([]);
  const [counts, setCounts] = useState({
    total: 0,
    queued: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    skipped: 0,
    inbound: 0,
    unreadInbound: 0,
  });
  const [rules, setRules] = useState<ReminderRuleDTO[]>([]);
  const [templates, setTemplates] = useState<MessageTemplateDTO[]>([]);
  const [clients, setClients] = useState<ClientDTO[]>([]);

  // Filters
  const [q, setQ] = useState('');
  const [channelFilter, setChannelFilter] = useState<'ALL' | MessageChannel>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | MessageStatus>('ALL');
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'OUTBOUND' | 'INBOUND'>('ALL');

  // Action states
  const [runningJob, setRunningJob] = useState(false);
  const [viewLog, setViewLog] = useState<MessageLogDTO | null>(null);

  // Rule modal
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ReminderRuleDTO | null>(null);
  const [ruleForm, setRuleForm] = useState({
    name: '',
    itemType: 'DOMAIN' as ReminderItemType,
    offsetsText: '60, 30, 15, 7, 3, 1, 0, -1, -3, -7',
    emailEnabled: true,
    waEnabled: true,
    templateId: '',
    enabled: true,
  });
  const [deleteRule, setDeleteRule] = useState<ReminderRuleDTO | null>(null);

  // Template modal & preview
  const [tplModalOpen, setTplModalOpen] = useState(false);
  const [editingTpl, setEditingTpl] = useState<MessageTemplateDTO | null>(null);
  const [tplForm, setTplForm] = useState({
    slug: '',
    name: '',
    language: 'en',
    channel: 'EMAIL' as MessageChannel,
    subject: '',
    body: '',
    waTemplateName: '',
    waLanguageCode: 'en',
    waVariableMappingText: '',
  });
  const [deleteTpl, setDeleteTpl] = useState<MessageTemplateDTO | null>(null);
  const [previewResult, setPreviewResult] = useState<{
    renderedSubject: string | null;
    renderedBody: string;
    sampleClientName: string;
  } | null>(null);

  // Manual Send Modal
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sendForm, setSendForm] = useState({
    clientId: '',
    channel: 'EMAIL' as MessageChannel,
    templateId: '',
    subject: '',
    body: '',
    attachKind: 'NONE' as 'NONE' | 'INVOICE' | 'ESTIMATE',
    attachId: '',
    dryRun: false,
  });
  const [clientInvoices, setClientInvoices] = useState<InvoiceDTO[]>([]);
  const [clientEstimates, setClientEstimates] = useState<EstimateDTO[]>([]);
  const [sendingManual, setSendingManual] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const logParams = new URLSearchParams();
      if (channelFilter !== 'ALL') logParams.set('channel', channelFilter);
      if (statusFilter !== 'ALL') logParams.set('status', statusFilter);
      if (directionFilter !== 'ALL') logParams.set('direction', directionFilter);
      if (q.trim()) logParams.set('q', q.trim());

      const [logsRes, rulesRes, tplsRes, clientsRes] = await Promise.all([
        apiRequest<{ items: MessageLogDTO[]; counts: typeof counts }>(
          `/api/messages/logs?${logParams.toString()}`
        ),
        apiRequest<{ items: ReminderRuleDTO[] }>('/api/messages/rules'),
        apiRequest<{ items: MessageTemplateDTO[] }>('/api/messages/templates'),
        apiRequest<{ items: ClientDTO[] }>('/api/clients?pageSize=100'),
      ]);

      setLogs(logsRes.items);
      setCounts(logsRes.counts);
      setRules(rulesRes.items);
      setTemplates(tplsRes.items);
      setClients(clientsRes.items);
    } catch (err: any) {
      showToast(err.message || 'Failed to load messaging data', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, [channelFilter, statusFilter, directionFilter]);

  useEffect(() => {
    if (!sendForm.clientId || !sendModalOpen) {
      setClientInvoices([]);
      setClientEstimates([]);
      return;
    }
    (async () => {
      try {
        const [invRes, estRes] = await Promise.all([
          apiRequest<{ items: InvoiceDTO[] }>(`/api/invoices?clientId=${encodeURIComponent(sendForm.clientId)}`),
          apiRequest<{ items: EstimateDTO[] }>(`/api/estimates?clientId=${encodeURIComponent(sendForm.clientId)}`),
        ]);
        setClientInvoices(invRes.items || []);
        setClientEstimates(estRes.items || []);
      } catch {
        // ignore attachment lookup error
      }
    })();
  }, [sendForm.clientId, sendModalOpen]);

  const activeRuleCount = useMemo(() => rules.filter((r) => r.enabled).length, [rules]);

  async function handleRunReminders(dispatchNow: boolean) {
    setRunningJob(true);
    try {
      const res = await apiRequest<{ summary: string }>('/api/messages/run-reminders', {
        method: 'POST',
        body: JSON.stringify({ dispatchNow }),
      });
      showToast(res.summary, 'success');
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Reminder run failed', 'error');
    } finally {
      setRunningJob(false);
    }
  }

  async function handleRunDigest() {
    setRunningJob(true);
    try {
      const res = await apiRequest<{ summary: string }>('/api/messages/run-digest', {
        method: 'POST',
      });
      showToast(res.summary, 'success');
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Digest run failed', 'error');
    } finally {
      setRunningJob(false);
    }
  }

  async function handleRetryLog(id: string) {
    try {
      const res = await apiRequest<{ result: { status: string; error?: string } }>(
        `/api/messages/logs/${id}/retry`,
        { method: 'POST' }
      );
      if (res.result.status === 'SENT') {
        showToast('Message dispatched successfully', 'success');
      } else {
        showToast(res.result.error || 'Retry failed', 'error');
      }
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Retry failed', 'error');
    }
  }

  async function handleSkipLog(id: string) {
    try {
      await apiRequest(`/api/messages/logs/${id}/skip`, { method: 'POST' });
      showToast('Marked as skipped', 'info');
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Could not skip entry', 'error');
    }
  }

  async function handleMarkRead(id: string) {
    try {
      await apiRequest(`/api/messages/logs/${id}/mark-read`, { method: 'POST' });
      showToast('Marked as read', 'info');
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Could not update message', 'error');
    }
  }

  async function handleMarkAllInboundRead() {
    try {
      await apiRequest('/api/messages/logs/mark-all-read', { method: 'POST' });
      showToast('All inbound replies marked read', 'success');
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Could not mark replies read', 'error');
    }
  }

  async function toggleRuleEnabled(rule: ReminderRuleDTO) {
    try {
      await apiRequest(`/api/messages/rules/${rule.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      showToast(rule.enabled ? 'Rule paused' : 'Rule enabled', 'success');
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Failed to update rule', 'error');
    }
  }

  async function saveRule(e: React.FormEvent) {
    e.preventDefault();
    const offsets = ruleForm.offsetsText
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n));
    const channels: MessageChannel[] = [];
    if (ruleForm.emailEnabled) channels.push('EMAIL');
    if (ruleForm.waEnabled) channels.push('WHATSAPP');

    if (offsets.length === 0) {
      showToast('Enter at least one integer day offset (e.g. 30, 7, 0, -3)', 'error');
      return;
    }
    if (channels.length === 0) {
      showToast('Select at least one channel (Email or WhatsApp)', 'error');
      return;
    }

    try {
      const payload = {
        name: ruleForm.name.trim(),
        itemType: ruleForm.itemType,
        offsets,
        channels,
        templateId: ruleForm.templateId || null,
        enabled: ruleForm.enabled,
      };
      if (editingRule) {
        await apiRequest(`/api/messages/rules/${editingRule.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToast('Reminder rule updated', 'success');
      } else {
        await apiRequest('/api/messages/rules', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('Reminder rule created', 'success');
      }
      setRuleModalOpen(false);
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Could not save rule', 'error');
    }
  }

  async function confirmDeleteRule() {
    if (!deleteRule) return;
    try {
      await apiRequest(`/api/messages/rules/${deleteRule.id}`, { method: 'DELETE' });
      setDeleteRule(null);
      showToast('Rule deleted', 'success');
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error');
    }
  }

  async function saveTemplate(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        slug: tplForm.slug.trim().toLowerCase(),
        name: tplForm.name.trim(),
        language: tplForm.language.trim(),
        channel: tplForm.channel,
        subject: tplForm.channel === 'EMAIL' ? tplForm.subject.trim() : null,
        body: tplForm.body,
        waTemplateName: tplForm.channel === 'WHATSAPP' ? tplForm.waTemplateName.trim() || null : null,
        waLanguageCode: tplForm.channel === 'WHATSAPP' ? tplForm.waLanguageCode.trim() || tplForm.language : null,
        waVariableMapping:
          tplForm.channel === 'WHATSAPP'
            ? tplForm.waVariableMappingText
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
      };
      if (editingTpl) {
        await apiRequest(`/api/messages/templates/${editingTpl.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToast('Template updated', 'success');
      } else {
        await apiRequest('/api/messages/templates', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('Template created', 'success');
      }
      setTplModalOpen(false);
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Could not save template', 'error');
    }
  }

  async function confirmDeleteTemplate() {
    if (!deleteTpl) return;
    try {
      await apiRequest(`/api/messages/templates/${deleteTpl.id}`, { method: 'DELETE' });
      setDeleteTpl(null);
      showToast('Template deleted', 'success');
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error');
    }
  }

  async function previewTemplate(subject: string | null, body: string) {
    try {
      const res = await apiRequest<{
        renderedSubject: string | null;
        renderedBody: string;
        sampleClientName: string;
      }>('/api/messages/templates/preview', {
        method: 'POST',
        body: JSON.stringify({ subject, body }),
      });
      setPreviewResult(res);
    } catch (err: any) {
      showToast(err.message || 'Preview failed', 'error');
    }
  }

  async function submitManualSend(e: React.FormEvent) {
    e.preventDefault();
    setSendingManual(true);
    try {
      await apiRequest('/api/messages/send-manual', {
        method: 'POST',
        body: JSON.stringify({
          clientId: sendForm.clientId,
          channel: sendForm.channel,
          templateId: sendForm.templateId || null,
          subject: sendForm.channel === 'EMAIL' ? sendForm.subject : null,
          body: sendForm.body,
          attachInvoiceId: sendForm.attachKind === 'INVOICE' && sendForm.attachId ? sendForm.attachId : null,
          attachEstimateId: sendForm.attachKind === 'ESTIMATE' && sendForm.attachId ? sendForm.attachId : null,
          dryRun: sendForm.dryRun,
        }),
      });
      showToast(
        sendForm.dryRun ? 'Dry-run message logged' : `${sendForm.channel} message sent`,
        'success'
      );
      setSendModalOpen(false);
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Failed to send message', 'error');
      loadAll();
    } finally {
      setSendingManual(false);
    }
  }

  function openSendModal() {
    const firstClient = clients[0];
    setSendForm({
      clientId: firstClient?.id || '',
      channel: 'EMAIL',
      templateId: '',
      subject: 'Update from Aligarh Web Solutions',
      body: 'Hello {{client_name}},\n\n',
      attachKind: 'NONE',
      attachId: '',
      dryRun: false,
    });
    setSendModalOpen(true);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Messages &amp; Reminders
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Automated renewal &amp; invoice reminder cadences, English/Hindi templates, and delivery log
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => handleRunReminders(false)}
            disabled={runningJob}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Play className="h-3.5 w-3.5" />
            {runningJob ? 'Running...' : 'Evaluate Reminders'}
          </button>
          <button
            type="button"
            onClick={openSendModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700 whitespace-nowrap"
          >
            <Send className="h-3.5 w-3.5" /> Send Message
          </button>
        </div>
      </div>

      {/* 4-Column Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Queued</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-sky-600 dark:text-sky-400">
            {counts.queued}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Sent / Delivered</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {counts.sent}{' '}
            <span className="text-xs font-normal text-slate-400">({counts.read} read)</span>
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Inbound Replies</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {counts.inbound}{' '}
            {counts.unreadInbound > 0 && (
              <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                ({counts.unreadInbound} unread)
              </span>
            )}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Failed</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">
            {counts.failed}
          </p>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1">
          {[
            { key: 'logs', label: `Notification Log (${counts.total})` },
            { key: 'rules', label: `Reminder Rules (${rules.length})` },
            { key: 'templates', label: `Templates (${templates.length})` },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSubTab(t.key as SubTab)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                subTab === t.key
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {subTab === 'logs' && (
          <div className="flex flex-wrap items-center gap-2">
            {counts.unreadInbound > 0 && (
              <button
                type="button"
                onClick={handleMarkAllInboundRead}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/50 whitespace-nowrap"
              >
                <Check className="h-3.5 w-3.5" /> Mark Replies Read
              </button>
            )}
            <button
              type="button"
              onClick={() => handleRunReminders(true)}
              disabled={runningJob}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Dispatch Queue Now
            </button>
            <button
              type="button"
              onClick={handleRunDigest}
              disabled={runningJob}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <Mail className="h-3.5 w-3.5" /> Send Owner Digest
            </button>
          </div>
        )}

        {subTab === 'rules' && (
          <button
            type="button"
            onClick={() => {
              setEditingRule(null);
              setRuleForm({
                name: '',
                itemType: 'DOMAIN',
                offsetsText: '60, 30, 15, 7, 3, 1, 0, -1, -3, -7',
                emailEnabled: true,
                waEnabled: true,
                templateId: '',
                enabled: true,
              });
              setRuleModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-700 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" /> New Rule
          </button>
        )}

        {subTab === 'templates' && (
          <button
            type="button"
            onClick={() => {
              setEditingTpl(null);
              setTplForm({
                slug: '',
                name: '',
                language: 'en',
                channel: 'EMAIL',
                subject: '',
                body: '',
                waTemplateName: '',
                waLanguageCode: 'en',
                waVariableMappingText: '',
              });
              setTplModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-700 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" /> New Template
          </button>
        )}
      </div>

      {/* Tab 1: Notification Log */}
      {subTab === 'logs' && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              loadAll();
            }}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3"
          >
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search client, subject, message, or error..."
              className="flex-1 min-w-[200px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs"
            />
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as any)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs"
            >
              <option value="ALL">All Channels</option>
              <option value="EMAIL">Email</option>
              <option value="WHATSAPP">WhatsApp</option>
            </select>
            <select
              value={directionFilter}
              onChange={(e) => setDirectionFilter(e.target.value as any)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs"
            >
              <option value="ALL">All Directions</option>
              <option value="OUTBOUND">Outbound</option>
              <option value="INBOUND">Inbound Replies</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs"
            >
              <option value="ALL">All Statuses</option>
              <option value="QUEUED">Queued</option>
              <option value="SENT">Sent</option>
              <option value="DELIVERED">Delivered</option>
              <option value="READ">Read</option>
              <option value="FAILED">Failed</option>
              <option value="SKIPPED">Skipped</option>
            </select>
            <button
              type="submit"
              className="rounded-lg bg-slate-900 dark:bg-slate-100 px-3.5 py-1.5 text-xs font-medium text-white dark:text-slate-900 whitespace-nowrap"
            >
              Filter
            </button>
          </form>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            {loading ? (
              <div className="p-8 text-center text-xs text-slate-500">Loading notification logs...</div>
            ) : logs.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  No notifications logged yet
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Click &ldquo;Evaluate Reminders&rdquo; to scan upcoming domain, service, and invoice due dates, or send a manual message.
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Client / Target</th>
                    <th className="px-4 py-2.5 font-medium">Channel</th>
                    <th className="px-4 py-2.5 font-medium">Trigger</th>
                    <th className="px-4 py-2.5 font-medium">Message</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {logs.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-2.5 font-mono whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {formatDateDDMMMYYYY(l.sentAt || l.scheduledAt || l.createdAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        {l.clientId && l.clientName ? (
                          <button
                            type="button"
                            onClick={() => onOpenClient(l.clientId!)}
                            className="font-medium text-sky-600 dark:text-sky-400 hover:underline text-left"
                          >
                            {l.clientName}
                          </button>
                        ) : (
                          <span className="font-medium text-slate-700 dark:text-slate-300">
                            {l.entityType === 'OWNER_DIGEST' ? 'Owner Digest' : 'System'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {l.channel} · {l.direction}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {l.entityType || 'MANUAL'}
                        {l.offsetDays !== null ? ` (${l.offsetDays >= 0 ? `+${l.offsetDays}` : l.offsetDays}d)` : ''}
                      </td>
                      <td className="px-4 py-2.5 max-w-xs">
                        {l.renderedSubject && (
                          <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            {l.renderedSubject}
                          </div>
                        )}
                        <div className="text-slate-500 dark:text-slate-400 truncate">
                          {l.renderedContent}
                        </div>
                        {l.error && (
                          <div className="text-red-600 dark:text-red-400 truncate mt-0.5">{l.error}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`font-mono font-semibold ${statusTextClass(l.status)}`}>
                          {l.status}
                        </span>
                        {l.retryCount > 0 && (
                          <span className="ml-1.5 font-mono text-slate-400">({l.retryCount}/3)</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap space-x-1.5">
                        <button
                          type="button"
                          onClick={() => setViewLog(l)}
                          title="View full message"
                          className="inline-flex items-center rounded border border-slate-200 dark:border-slate-700 p-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        {l.direction === 'INBOUND' && l.clientId && (
                          <button
                            type="button"
                            onClick={() => {
                              setSendForm({
                                clientId: l.clientId!,
                                channel: 'WHATSAPP',
                                templateId: '',
                                subject: '',
                                body: '',
                                attachKind: 'NONE',
                                attachId: '',
                                dryRun: false,
                              });
                              setSendModalOpen(true);
                            }}
                            title="Reply via WhatsApp"
                            className="inline-flex items-center rounded border border-slate-200 dark:border-slate-700 p-1 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {l.direction === 'INBOUND' && l.status !== 'READ' && (
                          <button
                            type="button"
                            onClick={() => handleMarkRead(l.id)}
                            title="Mark read"
                            className="inline-flex items-center rounded border border-slate-200 dark:border-slate-700 p-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {(l.status === 'FAILED' || l.status === 'QUEUED') && (
                          <button
                            type="button"
                            onClick={() => handleRetryLog(l.id)}
                            title={l.status === 'QUEUED' ? 'Dispatch now' : 'Retry delivery'}
                            className="inline-flex items-center rounded border border-slate-200 dark:border-slate-700 p-1 text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {(l.status === 'FAILED' || l.status === 'QUEUED') && (
                          <button
                            type="button"
                            onClick={() => handleSkipLog(l.id)}
                            title="Mark skipped"
                            className="inline-flex items-center rounded border border-slate-200 dark:border-slate-700 p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <SkipForward className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Reminder Rules */}
      {subTab === 'rules' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-2.5 font-medium">Rule Name</th>
                <th className="px-4 py-2.5 font-medium">Target</th>
                <th className="px-4 py-2.5 font-medium">Day Offsets</th>
                <th className="px-4 py-2.5 font-medium">Channels</th>
                <th className="px-4 py-2.5 font-medium">Template</th>
                <th className="px-4 py-2.5 font-medium">State</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rules.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">{r.name}</td>
                  <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">{r.itemType}</td>
                  <td className="px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {r.offsets.map((o) => (o > 0 ? `+${o}d` : `${o}d`)).join(', ')}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">
                    {r.channels.join(' · ')}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                    {r.templateName || 'Auto by channel'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleRuleEnabled(r)}
                      className={`font-mono font-semibold hover:underline ${
                        r.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
                      }`}
                    >
                      {r.enabled ? 'ENABLED' : 'PAUSED'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingRule(r);
                        setRuleForm({
                          name: r.name,
                          itemType: r.itemType,
                          offsetsText: r.offsets.join(', '),
                          emailEnabled: r.channels.includes('EMAIL'),
                          waEnabled: r.channels.includes('WHATSAPP'),
                          templateId: r.templateId || '',
                          enabled: r.enabled,
                        });
                        setRuleModalOpen(true);
                      }}
                      className="inline-flex rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteRule(r)}
                      className="inline-flex rounded p-1.5 text-slate-500 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 3: Message Templates */}
      {subTab === 'templates' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-xs text-slate-600 dark:text-slate-400">
            <span className="font-medium text-slate-900 dark:text-slate-100">Available Variables:</span>{' '}
            <span className="font-mono">{TEMPLATE_VARS.join('  ·  ')}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map((t) => (
              <div
                key={t.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col justify-between gap-3"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.name}</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                        {t.slug} · {t.channel} · {t.language.toUpperCase()}
                        {t.waTemplateName ? ` · Meta: ${t.waTemplateName}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => previewTemplate(t.subject, t.body)}
                        title="Preview rendered output"
                        className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTpl(t);
                          setTplForm({
                            slug: t.slug,
                            name: t.name,
                            language: t.language,
                            channel: t.channel,
                            subject: t.subject || '',
                            body: t.body,
                            waTemplateName: t.waTemplateName || '',
                            waLanguageCode: t.waLanguageCode || t.language,
                            waVariableMappingText: Array.isArray(t.waVariableMapping)
                              ? t.waVariableMapping.join(', ')
                              : '',
                          });
                          setTplModalOpen(true);
                        }}
                        className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTpl(t)}
                        className="rounded p-1.5 text-slate-500 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {t.subject && (
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Subject: {t.subject}
                    </p>
                  )}
                  <pre className="whitespace-pre-wrap font-sans text-xs text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-4">
                    {t.body}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* View Log Modal */}
      {viewLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Message Detail · {viewLog.channel}
              </h3>
              <button type="button" onClick={() => setViewLog(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1 font-mono">
              <div>Status: {viewLog.status} {viewLog.providerMessageId ? `(${viewLog.providerMessageId})` : ''}</div>
              <div>Scheduled: {viewLog.scheduledAt || 'Immediate'}</div>
              <div>Sent At: {viewLog.sentAt || '—'}</div>
              {viewLog.idempotencyKey && <div>Key: {viewLog.idempotencyKey}</div>}
            </div>
            {viewLog.renderedSubject && (
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 border-t border-slate-100 dark:border-slate-800 pt-3">
                {viewLog.renderedSubject}
              </div>
            )}
            <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-700 dark:text-slate-300 max-h-64 overflow-y-auto border-t border-slate-100 dark:border-slate-800 pt-3">
              {viewLog.renderedContent}
            </pre>
            {viewLog.error && (
              <p className="text-xs text-red-600 dark:text-red-400 border-t border-slate-100 dark:border-slate-800 pt-2">
                Error: {viewLog.error}
              </p>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setViewLog(null)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Template Modal */}
      {previewResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Template Preview ({previewResult.sampleClientName})
              </h3>
              <button type="button" onClick={() => setPreviewResult(null)} className="text-slate-400">
                <X className="h-5 w-5" />
              </button>
            </div>
            {previewResult.renderedSubject && (
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Subject: {previewResult.renderedSubject}
              </div>
            )}
            <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-700 dark:text-slate-300 border-t border-slate-100 dark:border-slate-800 pt-3">
              {previewResult.renderedBody}
            </pre>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setPreviewResult(null)}
                className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rule Modal */}
      {ruleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={saveRule}
            className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {editingRule ? 'Edit Reminder Rule' : 'New Reminder Rule'}
              </h3>
              <button type="button" onClick={() => setRuleModalOpen(false)} className="text-slate-400">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Rule Name</label>
              <input
                type="text"
                required
                value={ruleForm.name}
                onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Target Item Type</label>
                <select
                  value={ruleForm.itemType}
                  onChange={(e) => setRuleForm({ ...ruleForm, itemType: e.target.value as ReminderItemType })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="DOMAIN">Domain Renewals</option>
                  <option value="SERVICE">Hosting / Services</option>
                  <option value="INVOICE">Pending Invoices</option>
                  <option value="ESTIMATE">Pending Estimates</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Preferred Template</label>
                <select
                  value={ruleForm.templateId}
                  onChange={(e) => setRuleForm({ ...ruleForm, templateId: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="">Auto by channel &amp; type</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.channel})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                Day Offsets (comma-separated: positive = before due, negative = overdue)
              </label>
              <input
                type="text"
                required
                value={ruleForm.offsetsText}
                onChange={(e) => setRuleForm({ ...ruleForm, offsetsText: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
              />
            </div>
            <div className="flex flex-wrap items-center gap-5 text-xs">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={ruleForm.emailEnabled}
                  onChange={(e) => setRuleForm({ ...ruleForm, emailEnabled: e.target.checked })}
                />
                Email
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={ruleForm.waEnabled}
                  onChange={(e) => setRuleForm({ ...ruleForm, waEnabled: e.target.checked })}
                />
                WhatsApp
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={ruleForm.enabled}
                  onChange={(e) => setRuleForm({ ...ruleForm, enabled: e.target.checked })}
                />
                Rule Enabled
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRuleModalOpen(false)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700"
              >
                Save Rule
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Template Modal */}
      {tplModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={saveTemplate}
            className="w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {editingTpl ? 'Edit Template' : 'New Message Template'}
              </h3>
              <button type="button" onClick={() => setTplModalOpen(false)} className="text-slate-400">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Template Name</label>
                <input
                  type="text"
                  required
                  value={tplForm.name}
                  onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Slug (lowercase-hyphens)</label>
                <input
                  type="text"
                  required
                  disabled={Boolean(editingTpl)}
                  value={tplForm.slug}
                  onChange={(e) => setTplForm({ ...tplForm, slug: e.target.value })}
                  placeholder="domain-renewal-hi"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Channel</label>
                <select
                  value={tplForm.channel}
                  onChange={(e) => setTplForm({ ...tplForm, channel: e.target.value as MessageChannel })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="EMAIL">Email</option>
                  <option value="WHATSAPP">WhatsApp</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Language</label>
                <select
                  value={tplForm.language}
                  onChange={(e) => setTplForm({ ...tplForm, language: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="en">English (en)</option>
                  <option value="hi">Hindi (hi)</option>
                </select>
              </div>
            </div>

            {tplForm.channel === 'EMAIL' ? (
              <div>
                <label className="block text-xs font-medium mb-1">Email Subject</label>
                <input
                  type="text"
                  required
                  value={tplForm.subject}
                  onChange={(e) => setTplForm({ ...tplForm, subject: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">Meta Approved Template Name</label>
                    <input
                      type="text"
                      value={tplForm.waTemplateName}
                      onChange={(e) => setTplForm({ ...tplForm, waTemplateName: e.target.value })}
                      placeholder="domain_renewal_hi"
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">WhatsApp Language Code</label>
                    <input
                      type="text"
                      value={tplForm.waLanguageCode}
                      onChange={(e) => setTplForm({ ...tplForm, waLanguageCode: e.target.value })}
                      placeholder="hi"
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">
                    Meta Parameter Order (comma-separated variable keys)
                  </label>
                  <input
                    type="text"
                    value={tplForm.waVariableMappingText}
                    onChange={(e) => setTplForm({ ...tplForm, waVariableMappingText: e.target.value })}
                    placeholder="client_name, domain, expiry_date, days_left, amount, pay_link"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-xs"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium mb-1">Message Body</label>
              <textarea
                rows={6}
                required
                value={tplForm.body}
                onChange={(e) => setTplForm({ ...tplForm, body: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={() => previewTemplate(tplForm.channel === 'EMAIL' ? tplForm.subject : null, tplForm.body)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-medium"
              >
                <Eye className="h-3.5 w-3.5" /> Preview
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTplModalOpen(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700"
                >
                  Save Template
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Manual Send Message Modal */}
      {sendModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={submitManualSend}
            className="w-full max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Send Client Message
              </h3>
              <button type="button" onClick={() => setSendModalOpen(false)} className="text-slate-400">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Client</label>
                <select
                  required
                  value={sendForm.clientId}
                  onChange={(e) => setSendForm({ ...sendForm, clientId: e.target.value, attachId: '' })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="">Select client...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Channel</label>
                <select
                  value={sendForm.channel}
                  onChange={(e) =>
                    setSendForm({ ...sendForm, channel: e.target.value as MessageChannel, templateId: '' })
                  }
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="EMAIL">Email (SMTP / Brevo / Resend)</option>
                  <option value="WHATSAPP">WhatsApp Cloud API</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Load Template (Optional)</label>
              <select
                value={sendForm.templateId}
                onChange={(e) => {
                  const id = e.target.value;
                  const tpl = templates.find((t) => t.id === id);
                  setSendForm({
                    ...sendForm,
                    templateId: id,
                    ...(tpl ? { subject: tpl.subject || sendForm.subject, body: tpl.body } : {}),
                  });
                }}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="">Custom message...</option>
                {templates
                  .filter((t) => t.channel === sendForm.channel)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.language.toUpperCase()})
                    </option>
                  ))}
              </select>
            </div>

            {sendForm.channel === 'EMAIL' && (
              <>
                <div>
                  <label className="block text-xs font-medium mb-1">Subject</label>
                  <input
                    type="text"
                    required
                    value={sendForm.subject}
                    onChange={(e) => setSendForm({ ...sendForm, subject: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">Attach PDF (Optional)</label>
                    <select
                      value={sendForm.attachKind}
                      onChange={(e) =>
                        setSendForm({
                          ...sendForm,
                          attachKind: e.target.value as any,
                          attachId: '',
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    >
                      <option value="NONE">No PDF attachment</option>
                      <option value="INVOICE">Attach Invoice PDF</option>
                      <option value="ESTIMATE">Attach Estimate PDF</option>
                    </select>
                  </div>
                  {sendForm.attachKind !== 'NONE' && (
                    <div>
                      <label className="block text-xs font-medium mb-1">
                        Select {sendForm.attachKind === 'INVOICE' ? 'Invoice' : 'Estimate'}
                      </label>
                      <select
                        value={sendForm.attachId}
                        onChange={(e) => setSendForm({ ...sendForm, attachId: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                      >
                        <option value="">Select document...</option>
                        {sendForm.attachKind === 'INVOICE'
                          ? clientInvoices.map((inv) => (
                              <option key={inv.id} value={inv.id}>
                                {inv.invoiceNumber}
                              </option>
                            ))
                          : clientEstimates.map((est) => (
                              <option key={est.id} value={est.id}>
                                {est.estimateNumber}
                              </option>
                            ))}
                      </select>
                    </div>
                  )}
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-medium mb-1">Message Body</label>
              <textarea
                rows={5}
                required
                value={sendForm.body}
                onChange={(e) => setSendForm({ ...sendForm, body: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <input
                type="checkbox"
                checked={sendForm.dryRun}
                onChange={(e) => setSendForm({ ...sendForm, dryRun: e.target.checked })}
              />
              Dry-run only (simulate delivery &amp; write to log without calling external API/SMTP)
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSendModalOpen(false)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sendingManual || !sendForm.clientId}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {sendingManual ? 'Sending...' : 'Send Now'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteRule)}
        title="Delete Reminder Rule"
        message={`Delete rule "${deleteRule?.name || ''}"? Automated reminders using this rule will stop queuing.`}
        confirmLabel="Delete Rule"
        onConfirm={confirmDeleteRule}
        onCancel={() => setDeleteRule(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteTpl)}
        title="Delete Message Template"
        message={`Delete template "${deleteTpl?.name || ''}"? Rules referencing it will fall back to channel defaults.`}
        confirmLabel="Delete Template"
        onConfirm={confirmDeleteTemplate}
        onCancel={() => setDeleteTpl(null)}
      />
    </div>
  );
}
