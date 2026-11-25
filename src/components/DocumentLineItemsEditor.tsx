import { Plus, Trash2, BookOpen } from 'lucide-react';
import {
  BillingLineInput,
  GstModeType,
  amountInWordsINR,
  computeDocumentTotals,
} from '../../shared/billing';
import { CatalogItemDTO, DomainDTO, ServiceDTO } from '../../shared/types';
import { formatINR } from '../../shared/currency';

interface DocumentLineItemsEditorProps {
  items: BillingLineInput[];
  onChange: (items: BillingLineInput[]) => void;
  gstMode: GstModeType;
  applyRoundOff: boolean;
  onToggleRoundOff: (val: boolean) => void;
  adjustmentOverride?: number | null;
  adjustmentLabel?: string;
  onAdjustmentChange?: (next: { adjustmentOverride: number | null; adjustmentLabel: string }) => void;
  catalogItems: CatalogItemDTO[];
  clientDomains?: DomainDTO[];
  clientServices?: ServiceDTO[];
  showAssetLinking?: boolean;
  onOpenCatalogManager?: () => void;
}

export function DocumentLineItemsEditor({
  items,
  onChange,
  gstMode,
  applyRoundOff,
  onToggleRoundOff,
  adjustmentOverride = null,
  adjustmentLabel = '',
  onAdjustmentChange,
  catalogItems,
  clientDomains = [],
  clientServices = [],
  showAssetLinking = false,
  onOpenCatalogManager,
}: DocumentLineItemsEditorProps) {
  const hasCustomAdj = adjustmentOverride !== null && adjustmentOverride !== undefined;
  const totals = computeDocumentTotals(items, gstMode, applyRoundOff, adjustmentOverride);

  function updateRow(idx: number, patch: Partial<BillingLineInput>) {
    const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    onChange(next);
  }

  function addBlankRow() {
    onChange([
      ...items,
      { itemName: '', description: '', hsnSac: '998314', qty: 1, rate: 0, discount: 0, taxPercent: 18 },
    ]);
  }

  function insertCatalogItem(catalogId: string) {
    const found = catalogItems.find((c) => c.id === catalogId);
    if (!found) return;
    onChange([
      ...items,
      {
        itemName: found.name,
        description: found.description || found.name,
        hsnSac: found.hsnSac || '998314',
        qty: 1,
        rate: found.defaultRate,
        discount: 0,
        taxPercent: found.taxPercent,
      },
    ]);
  }

  function removeRow(idx: number) {
    if (items.length <= 1) return;
    onChange(items.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Line Items</span>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) insertCatalogItem(e.target.value);
            }}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200"
          >
            <option value="">+ Add from Catalog...</option>
            {catalogItems.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({formatINR(c.defaultRate)})
              </option>
            ))}
          </select>
          {onOpenCatalogManager && (
            <button
              type="button"
              onClick={onOpenCatalogManager}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <BookOpen className="h-3.5 w-3.5" /> Catalog
            </button>
          )}
          <button
            type="button"
            onClick={addBlankRow}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" /> Blank Line
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="px-2.5 py-2 font-medium min-w-[230px]">Item &amp; Description</th>
              <th className="px-2 py-2 font-medium w-24">HSN/SAC</th>
              <th className="px-2 py-2 font-medium w-16 text-right">Qty</th>
              <th className="px-2 py-2 font-medium w-24 text-right">Rate (₹)</th>
              <th className="px-2 py-2 font-medium w-20 text-right">Disc (₹)</th>
              <th className="px-2 py-2 font-medium w-18 text-right">GST %</th>
              <th className="px-2.5 py-2 font-medium w-24 text-right">Total</th>
              <th className="px-2 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((it, idx) => {
              const computed = totals.items[idx];
              return (
                <tr key={idx} className="align-top">
                  <td className="p-2 space-y-1.5">
                    <input
                      type="text"
                      value={it.itemName || ''}
                      onChange={(e) => updateRow(idx, { itemName: e.target.value })}
                      placeholder="Item title (e.g. Hosting Renewal, Domain Registration)"
                      className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs font-medium text-slate-900 dark:text-slate-100"
                    />
                    <textarea
                      rows={2}
                      value={it.description}
                      onChange={(e) => updateRow(idx, { description: e.target.value })}
                      placeholder="Detailed scope or description..."
                      className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs text-slate-700 dark:text-slate-300"
                    />
                    {showAssetLinking && (clientDomains.length > 0 || clientServices.length > 0) && (
                      <div className="flex flex-wrap gap-1.5">
                        {clientDomains.length > 0 && (
                          <select
                            value={it.domainId || ''}
                            onChange={(e) =>
                              updateRow(idx, { domainId: e.target.value || null, serviceId: e.target.value ? null : it.serviceId })
                            }
                            className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-600 dark:text-slate-400"
                          >
                            <option value="">Link Domain (optional)</option>
                            {clientDomains.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </select>
                        )}
                        {clientServices.length > 0 && (
                          <select
                            value={it.serviceId || ''}
                            onChange={(e) =>
                              updateRow(idx, { serviceId: e.target.value || null, domainId: e.target.value ? null : it.domainId })
                            }
                            className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-600 dark:text-slate-400"
                          >
                            <option value="">Link Service (optional)</option>
                            {clientServices.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.planName}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="p-2">
                    <input
                      type="text"
                      value={it.hsnSac || ''}
                      onChange={(e) => updateRow(idx, { hsnSac: e.target.value })}
                      placeholder="998314"
                      className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono text-xs"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={it.qty}
                      onChange={(e) => updateRow(idx, { qty: Number(e.target.value) })}
                      className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-right font-mono text-xs tabular-nums"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={it.rate}
                      onChange={(e) => updateRow(idx, { rate: Number(e.target.value) })}
                      className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-right font-mono text-xs tabular-nums"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={it.discount ?? 0}
                      onChange={(e) => updateRow(idx, { discount: Number(e.target.value) })}
                      className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-right font-mono text-xs tabular-nums"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="28"
                      disabled={gstMode === 'NONE'}
                      value={gstMode === 'NONE' ? 0 : it.taxPercent}
                      onChange={(e) => updateRow(idx, { taxPercent: Number(e.target.value) })}
                      className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-right font-mono text-xs tabular-nums disabled:opacity-50"
                    />
                  </td>
                  <td className="px-2.5 py-2.5 text-right font-mono font-medium text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                    {formatINR(computed?.lineTotal || 0, { decimals: 2 })}
                  </td>
                  <td className="p-2 text-center">
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      disabled={items.length <= 1}
                      className="rounded p-1 text-slate-400 hover:text-red-600 disabled:opacity-30"
                      aria-label="Remove line item"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Totals Summary */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5 text-xs">
        <div className="space-y-2 max-w-md">
          <div>
            <p className="text-slate-500 dark:text-slate-400">Amount in Words</p>
            <p className="font-medium text-slate-800 dark:text-slate-200">{amountInWordsINR(totals.total)}</p>
          </div>
          <label className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={applyRoundOff && !hasCustomAdj}
              disabled={hasCustomAdj}
              onChange={(e) => onToggleRoundOff(e.target.checked)}
              className="rounded border-slate-300"
            />
            Round off final total to nearest Rupee
          </label>
          {onAdjustmentChange && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasCustomAdj}
                  onChange={(e) => {
                    if (e.target.checked) {
                      onAdjustmentChange({
                        adjustmentOverride: 0,
                        adjustmentLabel: adjustmentLabel || 'Concession',
                      });
                    } else {
                      onAdjustmentChange({ adjustmentOverride: null, adjustmentLabel: '' });
                    }
                  }}
                  className="rounded border-slate-300"
                />
                Custom Adjustment / Concession
              </label>
              {hasCustomAdj && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={adjustmentLabel}
                    onChange={(e) =>
                      onAdjustmentChange({
                        adjustmentOverride: adjustmentOverride ?? 0,
                        adjustmentLabel: e.target.value,
                      })
                    }
                    placeholder="Concession / Adjustment"
                    className="w-32 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={adjustmentOverride ?? 0}
                    onChange={(e) =>
                      onAdjustmentChange({
                        adjustmentOverride: Number(e.target.value),
                        adjustmentLabel,
                      })
                    }
                    className="w-24 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-right font-mono text-xs tabular-nums"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="w-64 space-y-1.5 ml-auto">
          <div className="flex justify-between text-slate-600 dark:text-slate-400">
            <span>Subtotal</span>
            <span className="font-mono tabular-nums">{formatINR(totals.subtotal, { decimals: 2 })}</span>
          </div>
          {totals.discountTotal > 0 && (
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>Discount</span>
              <span className="font-mono tabular-nums">− {formatINR(totals.discountTotal, { decimals: 2 })}</span>
            </div>
          )}
          {gstMode === 'CGST_SGST' && (
            <>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>CGST</span>
                <span className="font-mono tabular-nums">{formatINR(totals.cgstTotal, { decimals: 2 })}</span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>SGST</span>
                <span className="font-mono tabular-nums">{formatINR(totals.sgstTotal, { decimals: 2 })}</span>
              </div>
            </>
          )}
          {gstMode === 'IGST' && (
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>IGST</span>
              <span className="font-mono tabular-nums">{formatINR(totals.igstTotal, { decimals: 2 })}</span>
            </div>
          )}
          {totals.roundOff !== 0 && (
            <div className="flex justify-between text-slate-500 dark:text-slate-400">
              <span>{hasCustomAdj && adjustmentLabel ? adjustmentLabel : 'Round Off'}</span>
              <span className="font-mono tabular-nums">{formatINR(totals.roundOff, { decimals: 2 })}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
            <span>Total</span>
            <span className="font-mono tabular-nums">{formatINR(totals.total, { decimals: 2 })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
