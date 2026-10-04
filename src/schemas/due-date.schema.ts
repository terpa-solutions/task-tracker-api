import { z } from 'zod';

type Operation = 'create' | 'update';

function isAbsent(value: string | null, operation: Operation): boolean {
  return value === null || value === '' || (operation === 'create' && !/[^ ]/.test(value));
}

function localCalendarDay(now: Date): string {
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0')).join('-');
}

/** Called after checking the exact shape, so every part contains decimal digits. */
function isValidCalendarDateTime(value: string): boolean {
  const [year, month, day, hour, minute, second] = value.split(/[- :]/).map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= monthDays[month - 1]
    && hour <= 23 && minute <= 59 && second <= 59;
}

export function dueDateSchema(operation: Operation, now: Date) {
  const absence = operation === 'create'
    ? ' Omit "due_date", or send null, an empty string, or ASCII spaces only to create without a due date.'
    : ' Send null or an empty string to remove the date; omit "due_date" to keep it. Spaces-only strings are not allowed.';
  const formatMessage = 'Field "due_date" must be a string in YYYY-MM-DD HH:mm:ss format, without a timezone, fractional seconds, surrounding spaces, tabs, or line breaks.' + absence;
  const today = localCalendarDay(now);

  return z.string({ error: formatMessage }).nullable().superRefine((value, ctx) => {
    if (value === null || isAbsent(value, operation)) return;
    // Exact length also prevents a trailing newline from passing a $ anchor.
    if (value.length !== 19 || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
      ctx.addIssue({ code: 'custom', message: formatMessage });
      return;
    }
    if (!isValidCalendarDateTime(value)) {
      ctx.addIssue({ code: 'custom', message: 'Field "due_date" must contain a valid calendar date and time in YYYY-MM-DD HH:mm:ss format.' });
      return;
    }
    // Compare calendar days in the API machine's local clock, not UTC or instants.
    if (value.slice(0, 10) < today) {
      ctx.addIssue({ code: 'custom', message: 'Field "due_date" must fall on today or a future day, based on the API machine\'s local date. Use YYYY-MM-DD HH:mm:ss.' });
    }
  }).transform(value => isAbsent(value, operation) ? null : value);
}
