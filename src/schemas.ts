import { z } from 'zod';
import { PRIORITIES } from './types.js';

/**
 * Upper bound on how many ids one bulk-complete call may carry.
 *
 * SQLite refuses a statement with more than 32766 bound parameters, so an
 * unbounded list would surface as a 500. 1000 stays well clear of that while
 * being far more than this endpoint realistically needs, and callers get a
 * clear 400 instead of a crash.
 */
export const BULK_COMPLETE_MAX_IDS = 1000;

const priority = z.enum(PRIORITIES, {
  error: `Field "priority" must be one of: ${PRIORITIES.join(', ')}.`,
});

/**
 * An ISO 8601 date, accepted either as a plain calendar date (`2026-08-10`) or
 * as a full timestamp with offset (`2026-08-10T09:00:00Z`).
 *
 * Both are accepted because "ISO date string" is ambiguous and rejecting a
 * timestamp would be a surprising 400. The value is stored verbatim rather than
 * normalised, so it round-trips exactly as the client sent it — and because ISO
 * 8601 sorts lexicographically, ordering and range queries still behave.
 *
 * Note this validates the *calendar*, not just the shape: 2026-02-30 is
 * rejected.
 */
const isoDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })], {
  error:
    'Field "due_date" must be an ISO date ("2026-08-10") or ISO datetime ("2026-08-10T09:00:00Z").',
});

const title = z
  .string({ error: 'Field "title" must be a string.' })
  .trim()
  .min(1, 'Field "title" must not be empty.');

/**
 * Body of POST /tasks.
 *
 * `.strict()` rejects unrecognised keys, so a typo like "prioritee" fails
 * loudly instead of being silently dropped and leaving the caller wondering why
 * the field did not stick.
 */
export const createTaskSchema = z
  .object({
    title,
    priority: priority.default('medium'),
    due_date: isoDate.nullish(),
  })
  .strict();

/**
 * Body of PATCH /tasks/:id — every field optional, but at least one required.
 *
 * `due_date` is nullable *and* optional, and the two mean different things:
 * omitted leaves the current value alone, while an explicit null clears it.
 */
export const updateTaskSchema = z
  .object({
    title: title.optional(),
    completed: z.boolean({ error: 'Field "completed" must be a boolean.' }).optional(),
    priority: priority.optional(),
    due_date: isoDate.nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    error:
      'Provide at least one of "title", "completed", "priority" or "due_date" to update.',
  });

/** Body of POST /tasks/bulk-complete. */
export const bulkCompleteSchema = z
  .object({
    ids: z
      .array(
        z
          .number({ error: 'Field "ids" must contain only positive integers.' })
          .int('Field "ids" must contain only positive integers.')
          .positive('Field "ids" must contain only positive integers.'),
        { error: 'Field "ids" is required and must be an array of task ids.' },
      )
      .min(1, 'Field "ids" must not be empty.')
      .max(
        BULK_COMPLETE_MAX_IDS,
        `Field "ids" must contain at most ${BULK_COMPLETE_MAX_IDS} ids.`,
      ),
  })
  .strict();

/**
 * Query string of GET /tasks.
 *
 * Deliberately *not* strict: unknown query params are stripped rather than
 * rejected, so clients can append things like cache-busting params. Filters
 * that are supplied but invalid still fail with a 400 — a typo such as
 * `?completed=1` should not quietly return the unfiltered list.
 */
export const listTasksQuerySchema = z.object({
  completed: z
    .enum(['true', 'false'], {
      error: 'Query param "completed" must be either "true" or "false".',
    })
    .optional(),
  priority: priority.optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type BulkCompleteInput = z.infer<typeof bulkCompleteSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

/**
 * Shape a ZodError into a 400 body.
 *
 * `error` stays a single human-readable sentence so simple clients can just
 * surface it, while `details` carries one entry per problem so a form UI can
 * map failures back to individual fields.
 */
export function toValidationError(error: z.ZodError): {
  error: string;
  details: { field: string; message: string }[];
} {
  const details = error.issues.map((issue) => ({
    // An empty path means the problem is with the object as a whole (an
    // unrecognised key, or the "at least one field" rule).
    field: issue.path.length > 0 ? issue.path.join('.') : '(body)',
    message: issue.message,
  }));

  return { error: details[0]?.message ?? 'Invalid request.', details };
}
