/**
 * Formats a numeric value in INR with Indian digit grouping (e.g. ₹1,24,500 or ₹1,24,500.50).
 */
export function formatINR(
  amount: number | string | null | undefined,
  options: { decimals?: number; showSymbol?: boolean } = {}
): string {
  const { decimals = 0, showSymbol = true } = options;
  const num = Number(amount ?? 0);
  const safeNum = Number.isFinite(num) ? num : 0;

  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(safeNum);

  return showSymbol ? `₹${formatted}` : formatted;
}
