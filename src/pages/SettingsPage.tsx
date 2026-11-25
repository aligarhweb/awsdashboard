import React, { useEffect, useState } from 'react';
import {
  Building2,
  KeyRound,
  Mail,
  ShieldCheck,
  Clock,
  FileText,
  Plus,
  Trash2,
  Edit2,
  Send,
  RefreshCw,
  Download,
  Database,
  X,
} from 'lucide-react';
import { apiRequest, downloadWithAuth } from '../lib/api';
import { AuthUserDTO, ProviderAccountDTO, ProviderKey, ProviderType, SettingsDTO } from '../../shared/types';
import { formatDateDDMMMYYYY } from '../../shared/dates';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface SettingsPageProps {
  initialTab?: string;
  user: AuthUserDTO;
  onUserUpdated: (user: AuthUserDTO) => void;
}

type TabKey = 'business' | 'providers' | 'messaging' | 'security' | 'cron' | 'audit';

export function SettingsPage({ initialTab, user, onUserUpdated }: SettingsPageProps) {
  const { showToast } = useToast();
  const [tab, setTab] = useState<TabKey>((initialTab as TabKey) || 'business');
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Secret write-only fields
  const [smtpPass, setSmtpPass] = useState('');
  const [emailApiKey, setEmailApiKey] = useState('');
  const [waAccessToken, setWaAccessToken] = useState('');
  const [waVerifyToken, setWaVerifyToken] = useState('');
  const [waAppSecret, setWaAppSecret] = useState('');
  const [testingSmtp, setTestingSmtp] = useState(false);

  // Providers
  const [providers, setProviders] = useState<ProviderAccountDTO[]>([]);
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ProviderAccountDTO | null>(null);
  const [providerForm, setProviderForm] = useState({
    name: '',
    providerKey: 'HOSTINGER' as ProviderKey,
    type: 'BOTH' as ProviderType,
    loginEmail: '',
    accountUrl: '',
    apiCredentials: '',
    apiSyncEnabled: false,
    notes: '',
  });
  const [deleteProvider, setDeleteProvider] = useState<ProviderAccountDTO | null>(null);

  // Security / 2FA
  const [curPassword, setCurPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [totpSetup, setTotpSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [disable2faPassword, setDisable2faPassword] = useState('');

  // Audit logs & jobs/backups
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [runningCron, setRunningCron] = useState(false);
  const [sendingBackup, setSendingBackup] = useState(false);
  const [demoActionLoading, setDemoActionLoading] = useState(false);
  const [clearDemoConfirm, setClearDemoConfirm] = useState(false);

  useEffect(() => {
    if (initialTab && ['business', 'providers', 'messaging', 'security', 'cron', 'audit'].includes(initialTab)) {
      setTab(initialTab as TabKey);
    }
  }, [initialTab]);

  async function loadAll() {
    setLoading(true);
    try {
      const [sRes, pRes, aRes, jRes] = await Promise.all([
        apiRequest<{ settings: SettingsDTO }>('/api/settings'),
        apiRequest<{ items: ProviderAccountDTO[] }>('/api/providers'),
        apiRequest<{ items: any[] }>('/api/settings/audit-logs?pageSize=40'),
        apiRequest<{ jobs: any[] }>('/api/settings/jobs'),
      ]);
      setSettings(sRes.settings);
      setProviders(pRes.items);
      setAuditLogs(aRes.items);
      setJobs(jRes.jobs || []);
    } catch (err: any) {
      showToast(err.message || 'Failed to load settings', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function saveSettings(patch: Record<string, any>) {
    setSaving(true);
    try {
      const res = await apiRequest<{ settings: SettingsDTO }>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setSettings(res.settings);
      setSmtpPass('');
      setEmailApiKey('');
      setWaAccessToken('');
      setWaVerifyToken('');
      setWaAppSecret('');
      showToast('Settings saved', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestSmtp() {
    setTestingSmtp(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/settings/test-smtp', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      showToast(res.message, 'success');
    } catch (err: any) {
      showToast(err.message || 'SMTP test failed', 'error');
    } finally {
      setTestingSmtp(false);
    }
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !settings) return;
    if (file.size > 250_000) {
      showToast('Please upload a logo under 250 KB', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setSettings({ ...settings, logoDataUrl: String(reader.result || '') });
    };
    reader.readAsDataURL(file);
  }

  async function saveProvider(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload: any = {
        name: providerForm.name.trim(),
        providerKey: providerForm.providerKey,
        type: providerForm.type,
        loginEmail: providerForm.loginEmail.trim() || null,
        accountUrl: providerForm.accountUrl.trim() || null,
        apiSyncEnabled: providerForm.apiSyncEnabled,
        notes: providerForm.notes.trim() || null,
      };
      if (providerForm.apiCredentials.trim()) {
        payload.apiCredentials = providerForm.apiCredentials.trim();
      }
      if (editingProvider) {
        await apiRequest(`/api/providers/${editingProvider.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToast('Provider updated', 'success');
      } else {
        await apiRequest('/api/providers', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('Provider added', 'success');
      }
      setProviderModalOpen(false);
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Could not save provider', 'error');
    }
  }

  async function confirmDeleteProvider() {
    if (!deleteProvider) return;
    try {
      await apiRequest(`/api/providers/${deleteProvider.id}`, { method: 'DELETE' });
      showToast('Provider deleted', 'success');
      setDeleteProvider(null);
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error');
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: curPassword, newPassword }),
      });
      setCurPassword('');
      setNewPassword('');
      showToast('Password updated successfully', 'success');
    } catch (err: any) {
      showToast(err.message || 'Password change failed', 'error');
    }
  }

  async function start2faSetup() {
    try {
      const res = await apiRequest<{ secret: string; qrDataUrl: string }>('/api/auth/2fa/setup', {
        method: 'POST',
      });
      setTotpSetup(res);
    } catch (err: any) {
      showToast(err.message || 'Could not initialize 2FA', 'error');
    }
  }

  async function enable2fa(e: React.FormEvent) {
    e.preventDefault();
    if (!totpSetup) return;
    try {
      await apiRequest('/api/auth/2fa/enable', {
        method: 'POST',
        body: JSON.stringify({ secret: totpSetup.secret, code: totpCode }),
      });
      setTotpSetup(null);
      setTotpCode('');
      onUserUpdated({ ...user, totpEnabled: true });
      showToast('Two-factor authentication enabled', 'success');
    } catch (err: any) {
      showToast(err.message || 'Invalid verification code', 'error');
    }
  }

  async function disable2fa(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest('/api/auth/2fa/disable', {
        method: 'POST',
        body: JSON.stringify({ password: disable2faPassword }),
      });
      setDisable2faPassword('');
      onUserUpdated({ ...user, totpEnabled: false });
      showToast('Two-factor authentication disabled', 'info');
    } catch (err: any) {
      showToast(err.message || 'Could not disable 2FA', 'error');
    }
  }

  async function runCronNow() {
    setRunningCron(true);
    try {
      const res = await apiRequest<{ executed: any[] }>('/api/cron/run-now', {
        method: 'POST',
        body: JSON.stringify({ forceAll: true }),
      });
      showToast(`Cron tick complete (${res.executed.length} jobs ran)`, 'success');
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Cron run failed', 'error');
    } finally {
      setRunningCron(false);
    }
  }

  async function handleSeedDemo() {
    setDemoActionLoading(true);
    try {
      const res = await apiRequest<{ clients: number; domains: number; services: number }>('/api/settings/demo/seed', {
        method: 'POST',
      });
      showToast(
        res.clients > 0
          ? `Loaded ${res.clients} demo clients, ${res.domains} domains, ${res.services} services`
          : 'Demo data is already present',
        'info'
      );
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Could not seed demo data', 'error');
    } finally {
      setDemoActionLoading(false);
    }
  }

  async function handleClearDemo() {
    setDemoActionLoading(true);
    try {
      await apiRequest('/api/settings/demo/clear', { method: 'POST' });
      setClearDemoConfirm(false);
      showToast('Demo records cleared', 'success');
      loadAll();
    } catch (err: any) {
      showToast(err.message || 'Could not clear demo data', 'error');
    } finally {
      setDemoActionLoading(false);
    }
  }

  if (loading || !settings) {
    return <div className="h-80 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />;
  }

  const tabs: Array<{ key: TabKey; label: string; icon: any }> = [
    { key: 'business', label: 'Business & Tax', icon: Building2 },
    { key: 'providers', label: 'Providers', icon: KeyRound },
    { key: 'messaging', label: 'Email & WhatsApp', icon: Mail },
    { key: 'security', label: 'Security & 2FA', icon: ShieldCheck },
    { key: 'cron', label: 'Cron & Demo Data', icon: Clock },
    { key: 'audit', label: 'Audit Log', icon: FileText },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Settings</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Business profile, encrypted provider credentials, SMTP, security, and background jobs
        </p>
      </div>

      {/* Tab Strip */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab 1: Business & Tax */}
      {tab === 'business' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveSettings(settings);
          }}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Business Name</label>
              <input
                type="text"
                value={settings.businessName}
                onChange={(e) => setSettings({ ...settings, businessName: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Home State (GST)</label>
              <input
                type="text"
                value={settings.businessState}
                onChange={(e) => setSettings({ ...settings, businessState: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">GSTIN</label>
              <input
                type="text"
                value={settings.gstin || ''}
                onChange={(e) => setSettings({ ...settings, gstin: e.target.value.toUpperCase() })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm uppercase"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">PAN</label>
              <input
                type="text"
                value={settings.pan || ''}
                onChange={(e) => setSettings({ ...settings, pan: e.target.value.toUpperCase() })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm uppercase"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Business Address</label>
              <input
                type="text"
                value={settings.address || ''}
                onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">UPI ID (for Invoice QR)</label>
              <input
                type="text"
                value={settings.upiId || ''}
                onChange={(e) => setSettings({ ...settings, upiId: e.target.value })}
                placeholder="aligarhwebsolutions@okicici"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Bank Name &amp; IFSC</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Bank Name"
                  value={settings.bankName || ''}
                  onChange={(e) => setSettings({ ...settings, bankName: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  placeholder="IFSC"
                  value={settings.bankIfsc || ''}
                  onChange={(e) => setSettings({ ...settings, bankIfsc: e.target.value.toUpperCase() })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm uppercase"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Bank Account Number</label>
              <input
                type="text"
                value={settings.bankAccountNumber || ''}
                onChange={(e) => setSettings({ ...settings, bankAccountNumber: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Bank Account Holder</label>
              <input
                type="text"
                value={settings.bankAccountName || ''}
                onChange={(e) => setSettings({ ...settings, bankAccountName: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Numbering Prefixes (Invoice / Estimate / Receipt)</label>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  value={settings.invoicePrefix}
                  onChange={(e) => setSettings({ ...settings, invoicePrefix: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                />
                <input
                  type="text"
                  value={settings.estimatePrefix}
                  onChange={(e) => setSettings({ ...settings, estimatePrefix: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                />
                <input
                  type="text"
                  value={settings.receiptPrefix}
                  onChange={(e) => setSettings({ ...settings, receiptPrefix: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Default GST % &amp; Mode</label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={settings.defaultTaxRate}
                  onChange={(e) => setSettings({ ...settings, defaultTaxRate: Number(e.target.value) })}
                  className="w-24 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                />
                <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={settings.gstEnabled}
                    onChange={(e) => setSettings({ ...settings, gstEnabled: e.target.checked })}
                  />
                  GST Enabled
                </label>
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Business Logo (for Invoice PDFs, stored in DB)
              </label>
              <div className="flex items-center gap-4">
                {settings.logoDataUrl && (
                  <img
                    src={settings.logoDataUrl}
                    alt="Business logo"
                    className="h-12 w-auto rounded border border-slate-200 dark:border-slate-700 bg-white p-1"
                  />
                )}
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoUpload} className="text-xs" />
                {settings.logoDataUrl && (
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, logoDataUrl: null })}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Business Settings'}
            </button>
          </div>
        </form>
      )}

      {/* Tab 2: Providers */}
      {tab === 'providers' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              API credentials are encrypted at rest with AES-256-GCM and never returned in plaintext.
            </p>
            <button
              type="button"
              onClick={() => {
                setEditingProvider(null);
                setProviderForm({
                  name: '',
                  providerKey: 'HOSTINGER',
                  type: 'BOTH',
                  loginEmail: '',
                  accountUrl: '',
                  apiCredentials: '',
                  apiSyncEnabled: false,
                  notes: '',
                });
                setProviderModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-700"
            >
              <Plus className="h-3.5 w-3.5" /> Add Provider
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
            {providers.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{p.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {p.providerKey} · {p.type}
                    {p.loginEmail ? ` · ${p.loginEmail}` : ''}
                    {p.hasApiCredentials ? ` · API key stored (${p.apiCredentialsMask})` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-mono text-slate-500 tabular-nums">
                    {p._count?.domains ?? 0} domains · {p._count?.services ?? 0} services
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingProvider(p);
                      setProviderForm({
                        name: p.name,
                        providerKey: p.providerKey,
                        type: p.type,
                        loginEmail: p.loginEmail || '',
                        accountUrl: p.accountUrl || '',
                        apiCredentials: '',
                        apiSyncEnabled: p.apiSyncEnabled,
                        notes: p.notes || '',
                      });
                      setProviderModalOpen(true);
                    }}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteProvider(p)}
                    className="rounded p-1.5 text-slate-500 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Messaging (SMTP & WhatsApp) */}
      {tab === 'messaging' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveSettings({
              ...settings,
              ...(smtpPass ? { smtpPass } : {}),
              ...(emailApiKey ? { emailApiKey } : {}),
              ...(waAccessToken ? { whatsappAccessToken: waAccessToken } : {}),
              ...(waVerifyToken ? { whatsappVerifyToken: waVerifyToken } : {}),
              ...(waAppSecret ? { whatsappAppSecret: waAppSecret } : {}),
            });
          }}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-6"
        >
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Email / SMTP (Hostinger Business Email Defaults)
              </h2>
              <button
                type="button"
                onClick={handleTestSmtp}
                disabled={testingSmtp}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Send className="h-3.5 w-3.5" />
                {testingSmtp ? 'Testing...' : 'Send Test Email'}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Email Provider</label>
                <select
                  value={settings.emailProvider || 'SMTP'}
                  onChange={(e) => setSettings({ ...settings, emailProvider: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="SMTP">SMTP (Hostinger Business Email)</option>
                  <option value="BREVO">Brevo Transactional API</option>
                  <option value="RESEND">Resend API</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Sender Display Name &amp; From Email
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Aligarh Web Solutions"
                    value={settings.smtpFromName}
                    onChange={(e) => setSettings({ ...settings, smtpFromName: e.target.value })}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                  <input
                    type="email"
                    placeholder="billing@aligarhwebsolutions.com"
                    value={settings.smtpFromEmail || ''}
                    onChange={(e) => setSettings({ ...settings, smtpFromEmail: e.target.value })}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {(settings.emailProvider || 'SMTP') === 'SMTP' ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">SMTP Host</label>
                    <input
                      type="text"
                      value={settings.smtpHost}
                      onChange={(e) => setSettings({ ...settings, smtpHost: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Port</label>
                      <input
                        type="number"
                        value={settings.smtpPort}
                        onChange={(e) => setSettings({ ...settings, smtpPort: Number(e.target.value) })}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                      />
                    </div>
                    <div className="flex items-end pb-2">
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={settings.smtpSecure}
                          onChange={(e) => setSettings({ ...settings, smtpSecure: e.target.checked })}
                        />
                        SSL/TLS (465)
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">SMTP Username</label>
                    <input
                      type="text"
                      value={settings.smtpUser || ''}
                      onChange={(e) => setSettings({ ...settings, smtpUser: e.target.value })}
                      placeholder="billing@aligarhwebsolutions.com"
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      SMTP Password {settings.hasSmtpPass ? '(Saved — leave blank to keep)' : ''}
                    </label>
                    <input
                      type="password"
                      value={smtpPass}
                      onChange={(e) => setSmtpPass(e.target.value)}
                      placeholder={settings.hasSmtpPass ? '••••••••' : 'Enter SMTP password'}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    />
                  </div>
                </>
              ) : (
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {settings.emailProvider} API Key {settings.hasEmailApiKey ? '(Encrypted & saved — leave blank to keep)' : ''}
                  </label>
                  <input
                    type="password"
                    value={emailApiKey}
                    onChange={(e) => setEmailApiKey(e.target.value)}
                    placeholder={settings.hasEmailApiKey ? '••••••••' : 'Enter provider API key'}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Owner Alert Email</label>
                <input
                  type="email"
                  value={settings.ownerAlertEmail || ''}
                  onChange={(e) => setSettings({ ...settings, ownerAlertEmail: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Owner Alert WhatsApp (E.164)</label>
                <input
                  type="text"
                  value={settings.ownerAlertWhatsapp || ''}
                  onChange={(e) => setSettings({ ...settings, ownerAlertWhatsapp: e.target.value })}
                  placeholder="+91..."
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Daily Reminder Evaluation Hour (IST)</label>
                <select
                  value={settings.reminderEvalHourIst}
                  onChange={(e) => setSettings({ ...settings, reminderEvalHourIst: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                >
                  {Array.from({ length: 24 }).map((_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00 IST
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Meta WhatsApp Cloud API, Webhook &amp; Quiet Hours
              </h2>
              <button
                type="button"
                onClick={() => {
                  const url = `${window.location.origin}/api/webhooks/whatsapp`;
                  navigator.clipboard?.writeText(url);
                  showToast('Webhook callback URL copied', 'info');
                }}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Copy Webhook URL
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Phone Number ID</label>
                <input
                  type="text"
                  value={settings.whatsappPhoneNumberId || ''}
                  onChange={(e) => setSettings({ ...settings, whatsappPhoneNumberId: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">WhatsApp Business Account ID</label>
                <input
                  type="text"
                  value={settings.whatsappBusinessAccountId || ''}
                  onChange={(e) => setSettings({ ...settings, whatsappBusinessAccountId: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Permanent Access Token {settings.hasWhatsappAccessToken ? '(Encrypted & saved)' : ''}
                </label>
                <input
                  type="password"
                  value={waAccessToken}
                  onChange={(e) => setWaAccessToken(e.target.value)}
                  placeholder={settings.hasWhatsappAccessToken ? '••••••••' : 'EAAG...'}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Webhook Verify Token {settings.hasWhatsappVerifyToken ? '(Encrypted & saved)' : ''}
                </label>
                <input
                  type="password"
                  value={waVerifyToken}
                  onChange={(e) => setWaVerifyToken(e.target.value)}
                  placeholder={settings.hasWhatsappVerifyToken ? '••••••••' : 'Random verify secret for Meta GET challenge'}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Meta App Secret (HMAC-SHA256) {settings.hasWhatsappAppSecret ? '(Encrypted & saved)' : ''}
                </label>
                <input
                  type="password"
                  value={waAppSecret}
                  onChange={(e) => setWaAppSecret(e.target.value)}
                  placeholder={settings.hasWhatsappAppSecret ? '••••••••' : 'Meta App Secret for X-Hub-Signature-256'}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Webhook Callback URL (Meta App Dashboard)
                </label>
                <input
                  type="text"
                  readOnly
                  value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/whatsapp`}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Quiet Hours Window (IST)</label>
                <div className="flex items-center gap-2 text-xs">
                  <input
                    type="text"
                    value={settings.quietHoursStart}
                    onChange={(e) => setSettings({ ...settings, quietHoursStart: e.target.value })}
                    className="w-24 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 font-mono text-sm"
                  />
                  <span>to</span>
                  <input
                    type="text"
                    value={settings.quietHoursEnd}
                    onChange={(e) => setSettings({ ...settings, quietHoursEnd: e.target.value })}
                    className="w-24 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 font-mono text-sm"
                  />
                </div>
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={settings.dryRunMode}
                    onChange={(e) => setSettings({ ...settings, dryRunMode: e.target.checked })}
                  />
                  Global Dry-Run Mode (log reminders without dispatching)
                </label>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Messaging Settings'}
            </button>
          </div>
        </form>
      )}

      {/* Tab 4: Security & 2FA */}
      {tab === 'security' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form
            onSubmit={handleChangePassword}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
          >
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Change Owner Password</h2>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Current Password</label>
              <input
                type="password"
                required
                value={curPassword}
                onChange={(e) => setCurPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">New Password (min 8 chars)</label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700"
            >
              Update Password
            </button>
          </form>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Two-Factor Authentication (TOTP)
            </h2>
            {user.totpEnabled ? (
              <form onSubmit={disable2fa} className="space-y-3">
                <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                  2FA is currently active on {user.email}.
                </p>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Enter Password to Disable 2FA
                  </label>
                  <input
                    type="password"
                    required
                    value={disable2faPassword}
                    onChange={(e) => setDisable2faPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-2 text-xs font-medium text-red-700 dark:text-red-300"
                >
                  Disable 2FA
                </button>
              </form>
            ) : totpSetup ? (
              <form onSubmit={enable2fa} className="space-y-3">
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Scan this QR code in Google Authenticator / Authy, then enter the 6-digit code.
                </p>
                <img src={totpSetup.qrDataUrl} alt="2FA QR Code" className="h-40 w-40 rounded border border-slate-200 bg-white p-1" />
                <p className="font-mono text-[11px] text-slate-500 break-all">Manual key: {totpSetup.secret}</p>
                <input
                  type="text"
                  required
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="6-digit code"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700"
                >
                  Verify &amp; Enable 2FA
                </button>
              </form>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Protect your admin console with time-based one-time passwords (TOTP).
                </p>
                <button
                  type="button"
                  onClick={start2faSetup}
                  className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700"
                >
                  Set Up 2FA Authenticator
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 5: Cron, Backups & Demo Data */}
      {tab === 'cron' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Hostinger hPanel / External Cron Tick
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Configure a 1–5 minute cron job on Hostinger hPanel or cron-job.org to trigger background tasks reliably.
                </p>
              </div>
              <button
                type="button"
                onClick={runCronNow}
                disabled={runningCron}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-700 whitespace-nowrap"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${runningCron ? 'animate-spin' : ''}`} />
                Run Tick Now
              </button>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 font-mono text-xs text-slate-800 dark:text-slate-200">
              {`curl -s -X POST -H "x-cron-secret: YOUR_CRON_SECRET" https://app.aligarhwebsolutions.com/api/cron/tick`}
            </pre>

            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 pt-1">
              <input
                type="checkbox"
                checked={settings.recurringAutoSend}
                onChange={(e) => saveSettings({ recurringAutoSend: e.target.checked })}
              />
              Automatically email recurring invoices (with PDF) to clients when generated
            </label>

            {jobs.length > 0 && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-3 py-2 font-medium">Job</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Last Run</th>
                      <th className="px-3 py-2 font-medium">Summary</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {jobs.map((j) => (
                      <tr key={j.jobName}>
                        <td className="px-3 py-2 font-mono font-medium text-slate-900 dark:text-slate-100">{j.jobName}</td>
                        <td className="px-3 py-2 font-mono">
                          <span className={j.lastStatus === 'ERROR' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>
                            {j.lastStatus || 'IDLE'}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">
                          {j.lastRunAt ? formatDateDDMMMYYYY(j.lastRunAt) : 'Never'}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{j.lastSummary || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Database Backups &amp; Portability
              </h2>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Weekly compressed JSON backups are emailed automatically to the Owner Alert Email via cron. Encrypted API keys, SMTP/WhatsApp secrets, passwords, and active sessions are automatically redacted from exports.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() =>
                  downloadWithAuth('/api/settings/backup/download?format=json', `aws-cc-backup-${new Date().toISOString().slice(0, 10)}.json`).catch(
                    (e) => showToast(e.message, 'error')
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" /> Download JSON Backup
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadWithAuth('/api/settings/backup/download?format=gz', `aws-cc-backup-${new Date().toISOString().slice(0, 10)}.json.gz`).catch(
                    (e) => showToast(e.message, 'error')
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" /> Download Compressed (.json.gz)
              </button>
              <button
                type="button"
                disabled={sendingBackup}
                onClick={async () => {
                  setSendingBackup(true);
                  try {
                    const res = await apiRequest<{ summary: string }>('/api/settings/backup/send-now', { method: 'POST' });
                    showToast(res.summary, 'success');
                  } catch (err: any) {
                    showToast(err.message || 'Could not email backup', 'error');
                  } finally {
                    setSendingBackup(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50 whitespace-nowrap"
              >
                <Send className="h-3.5 w-3.5" /> {sendingBackup ? 'Sending...' : 'Email Backup Now'}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Demo Data Management
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Demo clients, domains, services, and provider accounts are tagged separately so you can test workflows and remove them cleanly before going live.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleSeedDemo}
                disabled={demoActionLoading}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Load Realistic Demo Data
              </button>
              <button
                type="button"
                onClick={() => setClearDemoConfirm(true)}
                disabled={demoActionLoading}
                className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-2 text-xs font-medium text-red-700 dark:text-red-300"
              >
                Remove All Demo Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 6: Audit Log */}
      {tab === 'audit' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Action</th>
                  <th className="px-4 py-2.5 font-medium">Summary</th>
                  <th className="px-4 py-2.5 font-medium">Actor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {auditLogs.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2.5 font-mono text-slate-500 whitespace-nowrap">
                      {formatDateDDMMMYYYY(l.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 font-mono font-medium text-slate-700 dark:text-slate-300">
                      {l.action}
                    </td>
                    <td className="px-4 py-2.5 text-slate-800 dark:text-slate-200">{l.summary}</td>
                    <td className="px-4 py-2.5 text-slate-500">{l.actorEmail || 'system'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Provider Modal */}
      {providerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {editingProvider ? 'Edit Provider Account' : 'Add Provider Account'}
              </h3>
              <button type="button" onClick={() => setProviderModalOpen(false)} className="text-slate-400">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={saveProvider} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1">Account Display Name *</label>
                <input
                  type="text"
                  required
                  value={providerForm.name}
                  onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Provider</label>
                  <select
                    value={providerForm.providerKey}
                    onChange={(e) => setProviderForm({ ...providerForm, providerKey: e.target.value as ProviderKey })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="HOSTINGER">Hostinger</option>
                    <option value="GODADDY">GoDaddy</option>
                    <option value="SPACESHIP">Spaceship</option>
                    <option value="CLOUDFLARE">Cloudflare</option>
                    <option value="REDIFF">Rediff (Manual)</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Type</label>
                  <select
                    value={providerForm.type}
                    onChange={(e) => setProviderForm({ ...providerForm, type: e.target.value as ProviderType })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="BOTH">Registrar &amp; Host</option>
                    <option value="REGISTRAR">Registrar Only</option>
                    <option value="HOST">Hosting Only</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Login Email</label>
                <input
                  type="email"
                  value={providerForm.loginEmail}
                  onChange={(e) => setProviderForm({ ...providerForm, loginEmail: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  Optional API Key / JSON Credentials (encrypted via AES-256-GCM)
                </label>
                <input
                  type="password"
                  value={providerForm.apiCredentials}
                  onChange={(e) => setProviderForm({ ...providerForm, apiCredentials: e.target.value })}
                  placeholder={editingProvider?.hasApiCredentials ? 'Leave blank to keep existing key' : 'Optional API key/token'}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setProviderModalOpen(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm"
                >
                  Cancel
                </button>
                <button type="submit" className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white">
                  Save Provider
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteProvider)}
        title="Delete Provider Account"
        message={`Delete "${deleteProvider?.name}"? Domains and services linked to it will become unassigned.`}
        confirmLabel="Delete"
        onConfirm={confirmDeleteProvider}
        onCancel={() => setDeleteProvider(null)}
      />

      <ConfirmDialog
        open={clearDemoConfirm}
        title="Remove All Demo Data"
        message="This will remove all seeded demo clients, domains, services, and provider accounts. Your own records will remain untouched."
        confirmLabel="Remove Demo Data"
        loading={demoActionLoading}
        onConfirm={handleClearDemo}
        onCancel={() => setClearDemoConfirm(false)}
      />
    </div>
  );
}
