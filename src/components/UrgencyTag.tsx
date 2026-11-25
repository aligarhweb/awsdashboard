import { getUrgencyInfo, UrgencyLevel } from '../../shared/dates';

const LEVEL_STYLES: Record<UrgencyLevel, string> = {
  red: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-900/70',
  orange: 'text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/50 border-orange-200 dark:border-orange-900/70',
  yellow: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900/70',
  green: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900/70',
};

export function UrgencyTag({ targetDate }: { targetDate: string | Date }) {
  const info = getUrgencyInfo(targetDate);
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium font-mono tabular-nums whitespace-nowrap ${LEVEL_STYLES[info.level]}`}
    >
      {info.label}
    </span>
  );
}
