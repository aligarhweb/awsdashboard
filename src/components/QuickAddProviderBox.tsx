import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { ProviderAccountDTO, ProviderKey, ProviderType } from '../../shared/types';

interface QuickAddProviderBoxProps {
  defaultType?: ProviderType;
  onCreated: (provider: ProviderAccountDTO) => void;
  onCancel: () => void;
}

export function QuickAddProviderBox({
  defaultType = 'REGISTRAR',
  onCreated,
  onCancel,
}: QuickAddProviderBoxProps) {
  const [name, setName] = useState('');
  const [providerKey, setProviderKey] = useState<ProviderKey>('OTHER');
  const [type, setType] = useState<ProviderType>(defaultType);
  const [loginEmail, setLoginEmail] = useState('');
  const [accountUrl, setAccountUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Registrar / provider name is required');
      return;
    }

    const rawUrl = accountUrl.trim();
    const normalizedUrl =
      rawUrl && !/^https?:\/\//i.test(rawUrl) ? `https://${rawUrl}` : rawUrl;

    setError(null);
    setSaving(true);
    try {
      const res = await apiRequest<{ provider: ProviderAccountDTO }>('/api/providers', {
        method: 'POST',
        body: JSON.stringify({
          name: trimmedName,
          providerKey,
          type,
          loginEmail: loginEmail.trim() || null,
          accountUrl: normalizedUrl || null,
        }),
      });
      onCreated(res.provider);
    } catch (err: any) {
      setError(err.message || 'Could not add registrar / provider');
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleSave();
    }
  }

  return (
    <div className="rounded-lg border border-sky-200 dark:border-sky-900 bg-slate-50 dark:bg-slate-950/60 p-3.5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
          Add Registrar / Provider Manually
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          aria-label="Close quick add provider"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 px-2.5 py-1.5 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Provider / Registrar Name *
          </label>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Namecheap, BigRock, Porkbun, ResellerClub"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Platform
          </label>
          <select
            value={providerKey}
            onChange={(e) => setProviderKey(e.target.value as ProviderKey)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
          >
            <option value="OTHER">Custom / Other</option>
            <option value="HOSTINGER">Hostinger</option>
            <option value="GODADDY">GoDaddy</option>
            <option value="SPACESHIP">Spaceship</option>
            <option value="CLOUDFLARE">Cloudflare</option>
            <option value="REDIFF">Rediffmail</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Account Type
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ProviderType)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
          >
            <option value="REGISTRAR">Domain Registrar</option>
            <option value="HOST">Hosting / Cloud</option>
            <option value="BOTH">Registrar &amp; Host</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Account Email (optional)
          </label>
          <input
            type="email"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="admin@agency.com"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Panel URL (optional)
          </label>
          <input
            type="text"
            value={accountUrl}
            onChange={(e) => setAccountUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="https://ap.www.namecheap.com"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50 whitespace-nowrap"
        >
          <Plus className="h-3.5 w-3.5" />
          {saving ? 'Adding...' : 'Save & Select'}
        </button>
      </div>
    </div>
  );
}
