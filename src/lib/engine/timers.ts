import { DEFAULT_ORG_RULES } from './rules';
import type { ClaimPreviewRecord, ClaimTimerStatus } from './types';

function toUtcDateKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysUtc(date: Date, days: number): Date {
  const copy = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/** Anonymous Gregorian Easter Sunday algorithm (UTC) */
function computeEasterSundayUtc(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * South African statutory public holidays for a given year,
 * including observed Mondays under the Public Holidays Act 36 of 1994.
 */
export function getSaPublicHolidays(year: number): Set<string> {
  const fixedDates: Array<[number, number]> = [
    [1, 1], // New Year's Day
    [3, 21], // Human Rights Day
    [4, 27], // Freedom Day
    [5, 1], // Workers' Day
    [6, 16], // Youth Day
    [8, 9], // National Women's Day
    [9, 24], // Heritage Day
    [12, 16], // Day of Reconciliation
    [12, 25], // Christmas Day
    [12, 26], // Day of Goodwill
  ];

  const holidays = new Set<string>();

  for (const [month, day] of fixedDates) {
    const dt = new Date(Date.UTC(year, month - 1, day));
    holidays.add(toUtcDateKey(dt));
    // Public Holidays Act s2(1): whenever a public holiday falls on a Sunday, the following Monday is a public holiday
    if (dt.getUTCDay() === 0) {
      holidays.add(toUtcDateKey(addDaysUtc(dt, 1)));
    }
  }

  const easter = computeEasterSundayUtc(year);
  const goodFriday = addDaysUtc(easter, -2);
  const familyDay = addDaysUtc(easter, 1);
  holidays.add(toUtcDateKey(goodFriday));
  holidays.add(toUtcDateKey(familyDay));

  return holidays;
}

export function isSaBusinessDay(date: Date): boolean {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  const holidays = getSaPublicHolidays(date.getUTCFullYear());
  return !holidays.has(toUtcDateKey(date));
}

export function addSaBusinessDays(startIso: string, businessDays: number): Date {
  const start = new Date(startIso);
  let cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  let remaining = businessDays;

  while (remaining > 0) {
    cursor = addDaysUtc(cursor, 1);
    if (isSaBusinessDay(cursor)) {
      remaining -= 1;
    }
  }
  return cursor;
}

export function countSaBusinessDaysBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso);
  const end = new Date(endIso);
  let cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  const endDay = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
  );

  if (endDay <= cursor) return 0;

  let count = 0;
  while (cursor < endDay) {
    cursor = addDaysUtc(cursor, 1);
    if (isSaBusinessDay(cursor)) {
      count += 1;
    }
  }
  return count;
}

export function evaluateClaimTimers(
  claim: Pick<
    ClaimPreviewRecord,
    'submitted_at' | 'has_dispute_notice' | 'dispute_opened_at'
  >,
  referenceNowIso: string,
): ClaimTimerStatus {
  const initialDeadline = addSaBusinessDays(
    claim.submitted_at,
    DEFAULT_ORG_RULES.ppr_initial_business_days,
  );
  const initialElapsed = countSaBusinessDaysBetween(
    claim.submitted_at,
    referenceNowIso,
  );
  const initialRemaining = Math.max(
    0,
    DEFAULT_ORG_RULES.ppr_initial_business_days - initialElapsed,
  );
  const initialBreached =
    !claim.has_dispute_notice &&
    initialElapsed > DEFAULT_ORG_RULES.ppr_initial_business_days;

  let dispute_deadline_iso: string | null = null;
  let dispute_business_days_elapsed: number | null = null;
  let dispute_business_days_remaining: number | null = null;
  let dispute_breached = false;

  if (claim.has_dispute_notice && claim.dispute_opened_at) {
    const disputeDeadline = addSaBusinessDays(
      claim.dispute_opened_at,
      DEFAULT_ORG_RULES.ppr_dispute_business_days,
    );
    const dElapsed = countSaBusinessDaysBetween(
      claim.dispute_opened_at,
      referenceNowIso,
    );
    dispute_deadline_iso = disputeDeadline.toISOString().slice(0, 10);
    dispute_business_days_elapsed = dElapsed;
    dispute_business_days_remaining = Math.max(
      0,
      DEFAULT_ORG_RULES.ppr_dispute_business_days - dElapsed,
    );
    dispute_breached = dElapsed > DEFAULT_ORG_RULES.ppr_dispute_business_days;
  }

  const ficAdvisory = addSaBusinessDays(
    claim.submitted_at,
    DEFAULT_ORG_RULES.fic_advisory_working_days,
  );

  let clock_label = `2-day clock: ${initialRemaining} biz day(s) left`;
  if (claim.has_dispute_notice && dispute_business_days_remaining !== null) {
    clock_label = dispute_breached
      ? '14-day dispute SLA breached'
      : `14-day dispute clock: ${dispute_business_days_remaining} biz day(s) left`;
  } else if (initialBreached) {
    clock_label = '2-day initial SLA breached (Basdeo notice required)';
  }

  return {
    initial_deadline_iso: initialDeadline.toISOString().slice(0, 10),
    initial_business_days_elapsed: initialElapsed,
    initial_business_days_remaining: initialRemaining,
    initial_breached: initialBreached,
    dispute_deadline_iso,
    dispute_business_days_elapsed,
    dispute_business_days_remaining,
    dispute_breached,
    fic_advisory_deadline_iso: ficAdvisory.toISOString().slice(0, 10),
    clock_label,
  };
}
