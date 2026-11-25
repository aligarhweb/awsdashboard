import React, { useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X, Download } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useToast } from './Toast';

export type CsvImportTarget = 'clients' | 'domains' | 'services' | 'estimates';

interface CsvImportModalProps {
  open: boolean;
  target: CsvImportTarget;
  onClose: () => void;
  onImported: () => void;
}

const SAMPLE_CSV: Record<CsvImportTarget, { filename: string; content: string; hint: string }> = {
  clients: {
    filename: 'sample-clients.csv',
    hint: 'Supports standard CSV or Zoho Books Contacts.csv exports. Required: name (or Display Name). Optional: company, contact_person, emails, whatsapp_phone (+91...), state, gstin, preferred_channel (EMAIL/WHATSAPP/BOTH), tags.',
    content: `name,company,contact_person,emails,whatsapp_phone,state,gstin,preferred_channel,tags
Aligarh Agro Foods,Aligarh Agro Foods Pvt Ltd,Salman Khan,salman@aligarhagro.in,+919837001122,Uttar Pradesh,09AABCA1234F1Z5,BOTH,food;priority
Surya Textiles,Surya Textiles India,Ramesh Gupta,accounts@suryatextiles.com,+919811112233,Delhi,,EMAIL,retail`,
  },
  domains: {
    filename: 'sample-domains.csv',
    hint: 'Required: domain, client (exact client name/company), expiry_date (YYYY-MM-DD). Optional: provider, cost_price, selling_price, auto_renew, who_pays (CLIENT/ME), dns_provider.',
    content: `domain,client,provider,expiry_date,cost_price,selling_price,auto_renew,who_pays,dns_provider
aligarhagro.in,Aligarh Agro Foods,Hostinger,2027-02-15,749,1200,true,CLIENT,Cloudflare
suryatextiles.com,Surya Textiles,GoDaddy,2026-12-10,1050,1600,false,CLIENT,GoDaddy DNS`,
  },
  services: {
    filename: 'sample-services.csv',
    hint: 'Required: plan_name, client (exact client name/company), renewal_date (YYYY-MM-DD). Optional: type (HOSTING/EMAIL_HOSTING/SSL/MAINTENANCE_AMC/CDN/OTHER), provider, billing_cycle (MONTHLY/QUARTERLY/YEARLY/MULTI_YEAR), cost_price, selling_price.',
    content: `plan_name,type,client,provider,renewal_date,billing_cycle,cost_price,selling_price,auto_renew
Business Cloud Plan,HOSTING,Aligarh Agro Foods,Hostinger,2027-01-20,YEARLY,2400,6000,true
Annual AMC Support,MAINTENANCE_AMC,Surya Textiles,Hostinger,2026-12-28,YEARLY,0,5000,false`,
  },
  estimates: {
    filename: 'sample-estimates.csv',
    hint: 'Supports Zoho Books Estimate.csv exports (groups multi-row line items by Estimate ID/Number). Matches existing clients automatically by Zoho Customer ID or Customer Name.',
    content: `Estimate Date,Estimate Number,Estimate Status,Expiry Date,PurchaseOrder,Project Name,Customer Name,Place of Supply(With State Code),Adjustment,Adjustment Description,Item Name,Item Desc,HSN/SAC,Quantity,Item Price,Discount Amount,Item Tax %
2026-11-24,EST-000100,sent,2026-12-09,Meeting on Nov 24,Corporate Website,Aligarh Agro Foods,09-Uttar Pradesh,0.00,Adjustment,Website Design - BUSINESS,15 Dynamic Pages + Domain + Hosting,998314,1,12000.00,0.00,18`,
  },
};

export function CsvImportModal({ open, target, onClose, onImported }: CsvImportModalProps) {
  const { showToast } = useToast();
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const sample = SAMPLE_CSV[target];
  const titleMap: Record<CsvImportTarget, string> = {
    clients: 'Import Clients from CSV',
    domains: 'Import Domains from CSV',
    services: 'Import Services from CSV',
    estimates: 'Import Estimates from CSV',
  };

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result || ''));
      setPreview(null);
    };
    reader.readAsText(file);
  }

  function downloadSample() {
    const blob = new Blob([sample.content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sample.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function runPreview() {
    if (!csvText.trim()) {
      showToast('Paste CSV content or upload a .csv file first', 'error');
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest(`/api/${target}/import`, {
        method: 'POST',
        body: JSON.stringify({ csvText, dryRun: true }),
      });
      setPreview(res);
    } catch (err: any) {
      showToast(err.message || 'CSV validation failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function commitImport() {
    setLoading(true);
    try {
      const res = await apiRequest(`/api/${target}/import`, {
        method: 'POST',
        body: JSON.stringify({ csvText, dryRun: false }),
      });
      showToast(`Imported ${res.createdCount} ${target} successfully`, 'success');
      setCsvText('');
      setPreview(null);
      onImported();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Import failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="h-5 w-5 text-sky-600 dark:text-sky-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{titleMap[target]}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-3.5 text-xs text-slate-600 dark:text-slate-400">
            <p className="flex-1 leading-relaxed">{sample.hint}</p>
            <button
              type="button"
              onClick={downloadSample}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              Sample CSV
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Upload CSV file or paste rows below
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
                <Upload className="h-3.5 w-3.5" />
                Choose .csv file
                <input type="file" accept=".csv,text/csv" className="sr-only" onChange={handleFileChange} />
              </label>
            </div>
            <textarea
              rows={6}
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                setPreview(null);
              }}
              placeholder={sample.content}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>

          {preview && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Validation Preview ({preview.totalRows} rows)
                </span>
                <div className="flex items-center gap-3 font-mono tabular-nums">
                  <span className="text-emerald-700 dark:text-emerald-400">
                    {preview.validCount} valid
                  </span>
                  <span className="text-red-600 dark:text-red-400">
                    {preview.invalidCount} errors
                  </span>
                </div>
              </div>
              <div className="max-h-56 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Item</th>
                      <th className="px-3 py-2 font-medium">Notes / Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {preview.rows.map((r: any) => (
                      <tr key={r.rowNumber}>
                        <td className="px-3 py-2 font-mono text-slate-500">{r.rowNumber}</td>
                        <td className="px-3 py-2">
                          {r.valid ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Valid
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                              <AlertCircle className="h-3.5 w-3.5" /> Error
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                          {r.data?.name || r.domainName || r.planName || '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                          {r.error ? (
                            <span className="text-red-600 dark:text-red-400">{r.error}</span>
                          ) : (
                            <span>{r.clientName || r.data?.company || 'Ready to import'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 dark:border-slate-800 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={runPreview}
            disabled={loading || !csvText.trim()}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-900 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            {loading ? 'Checking...' : 'Validate Preview'}
          </button>
          <button
            type="button"
            onClick={commitImport}
            disabled={loading || !preview || preview.validCount === 0}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            Import {preview?.validCount ? `${preview.validCount} Valid Rows` : 'Rows'}
          </button>
        </div>
      </div>
    </div>
  );
}
