import { z } from 'zod';
import { PRIORITIES, type IsoDateString } from './types.js';

export const BULK_COMPLETE_MAX_IDS = 1000;

/**
 * Accepts `YYYY-MM-DD` or a full ISO 8601 datetime with an explicit offset
 * (`Z` or `±HH:MM`); a datetime without an offset would be parsed in the
 * server's local timezone, so it is rejected.
 */
const ISO_DATE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/;

/**
 * Parse an ISO date string into its canonical UTC form, or null when invalid.
 * Impossible calendar dates (e.g. 2026-02-30) are rejected rather than rolled over.
 */
function toIsoDateString(value: string): IsoDateString | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  const calendarDay = new Date(Date.UTC(+year, +month - 1, +day));
  if (calendarDay.getUTCMonth() !== +month - 1 || calendarDay.getUTCDate() !== +day) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const titleSchema = z
  .string({
    error: (issue) => (issue.input === undefined ? 'Required.' : 'Must be a string.'),
  })
  .trim()
  .min(1, { error: 'Must not be empty.' });

const prioritySchema = z.enum(PRIORITIES, {
  error: `Must be one of: ${PRIORITIES.join(', ')}.`,
});

/** ISO 8601 date string normalized to UTC, or null to leave/clear it unset. */
const dueDateSchema = z
  .string({ error: 'Must be an ISO 8601 date string or null.' })
  .transform((value, ctx) => {
    const iso = toIsoDateString(value);
    if (iso === null) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Must be an ISO 8601 date string (e.g. "2026-12-31" or "2026-12-31T17:00:00Z").',
      });
      return z.NEVER;
    }
    return iso;
  })
  .nullable();

/** Route `:id` param. A strict pattern, since `Number()` also accepts "0x10" or "1e2". */
export const taskIdSchema = z
  .string()
  .regex(/^[1-9]\d*$/, { error: 'Must be a positive integer.' })
  .transform(Number);

/** Body of POST /tasks. Unknown fields are rejected so typos surface as 400s. */
export const createTaskSchema = z.strictObject({
  title: titleSchema,
  priority: prioritySchema.default('medium'),
  due_date: dueDateSchema.default(null),
});

/** Body of PATCH /tasks/:id. Every field is optional, but at least one is required. */
export const updateTaskSchema = z
  .strictObject({
    title: titleSchema.optional(),
    completed: z.boolean({ error: 'Must be a boolean.' }).optional(),
    priority: prioritySchema.optional(),
    due_date: dueDateSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    error: 'Provide at least one of "title", "completed", "priority" or "due_date".',
  });

/** Body of POST /tasks/bulk-complete. */
export const bulkCompleteSchema = z.strictObject({
  ids: z
    .array(z.int({ error: 'Must be an integer.' }).positive({ error: 'Must be positive.' }), {
      error: (issue) =>
        issue.input === undefined ? 'Required.' : 'Must be an array of task ids.',
    })
    .min(1, { error: 'Must contain at least one id.' })
    .max(BULK_COMPLETE_MAX_IDS, {
      error: `Must contain at most ${BULK_COMPLETE_MAX_IDS} ids.`,
    }),
});

/**
 * Query of GET /tasks. `completed` is matched literally: `z.coerce.boolean()`
 * would turn the string "false" into `true`. Unknown params are rejected, like
 * unknown body fields, so a typo such as `?priorty=high` is a 400 instead of
 * an unfiltered list.
 */
export const listTasksQuerySchema = z.strictObject({
  completed: z
    .enum(['true', 'false'], { error: 'Must be "true" or "false".' })
    .transform((value) => value === 'true')
    .optional(),
  priority: prioritySchema.optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
