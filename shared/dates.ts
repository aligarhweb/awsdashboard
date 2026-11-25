export type UrgencyLevel = 'green' | 'yellow' | 'orange' | 'red';

export interface UrgencyInfo {
  daysLeft: number;
  level: UrgencyLevel;
  label: string;
}

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Returns YYYY-MM-DD in Asia/Kolkata timezone (or configured timezone).
 */
export function getIstDateParts(dateInput: Date | string, timeZone = 'Asia/Kolkata'): {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
  hour: number;
  minute: number;
} {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === '24' ? '0' : map.hour),
    minute: Number(map.minute),
  };
}

/**
 * Formats a date in DD-MMM-YYYY (e.g. 24-Nov-2026) in Asia/Kolkata.
 */
export function formatDateDDMMMYYYY(dateInput: Date | string | null | undefined, timeZone = 'Asia/Kolkata'): string {
  if (!dateInput) return '—';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return '—';
  const { year, month, day } = getIstDateParts(date, timeZone);
  const dd = String(day).padStart(2, '0');
  const mmm = MONTHS_SHORT[month - 1] || 'Jan';
  return `${dd}-${mmm}-${year}`;
}

/**
 * Computes integer calendar days difference (target IST date minus reference IST date).
 * Positive => days remaining; 0 => due today; Negative => days overdue/expired.
 */
export function getDaysLeftIST(
  targetDate: Date | string,
  nowDate: Date = new Date(),
  timeZone = 'Asia/Kolkata'
): number {
  const target = getIstDateParts(targetDate, timeZone);
  const now = getIstDateParts(nowDate, timeZone);
  const targetUtcDay = Date.UTC(target.year, target.month - 1, target.day);
  const nowUtcDay = Date.UTC(now.year, now.month - 1, now.day);
  return Math.round((targetUtcDay - nowUtcDay) / 86_400_000);
}

/**
 * Urgency rules per spec:
 * green > 60 days, yellow 30–60, orange 8–30, red <= 7 or expired.
 */
export function getUrgencyInfo(
  targetDate: Date | string,
  nowDate: Date = new Date(),
  timeZone = 'Asia/Kolkata'
): UrgencyInfo {
  const daysLeft = getDaysLeftIST(targetDate, nowDate, timeZone);

  if (daysLeft < 0) {
    const ago = Math.abs(daysLeft);
    return {
      daysLeft,
      level: 'red',
      label: ago === 1 ? 'Expired 1 day ago' : `Expired ${ago} days ago`,
    };
  }
  if (daysLeft === 0) {
    return { daysLeft: 0, level: 'red', label: 'Expires today' };
  }
  if (daysLeft <= 7) {
    return {
      daysLeft,
      level: 'red',
      label: daysLeft === 1 ? '1 day left' : `${daysLeft} days left`,
    };
  }
  if (daysLeft <= 30) {
    return { daysLeft, level: 'orange', label: `${daysLeft} days left` };
  }
  if (daysLeft <= 60) {
    return { daysLeft, level: 'yellow', label: `${daysLeft} days left` };
  }
  return { daysLeft, level: 'green', label: `${daysLeft} days left` };
}

/**
 * Derives domain/service status from expiry/renewal date unless manually transferred/cancelled/suspended/redemption.
 */
export function computeAutoExpiryStatus(
  expiryDate: Date | string,
  currentStatus: string,
  nowDate: Date = new Date()
): 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | string {
  const lockedStatuses = new Set(['REDEMPTION', 'TRANSFERRED', 'SUSPENDED', 'CANCELLED']);
  if (lockedStatuses.has(currentStatus)) {
    return currentStatus;
  }
  const daysLeft = getDaysLeftIST(expiryDate, nowDate);
  if (daysLeft < 0) return 'EXPIRED';
  if (daysLeft <= 30) return 'EXPIRING';
  return 'ACTIVE';
}
