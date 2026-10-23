import { z } from 'zod';
import { PRIORITIES, type Priority } from './types.js';

// Error messages (the first issue's message is returned as `error`).
export const TITLE_REQUIRED_ERROR =
  'Field "title" is required and must be a non-empty string.';
export const TITLE_ERROR = 'Field "title" must be a non-empty string.';
export const COMPLETED_BOOL_ERROR = 'Field "completed" must be a boolean.';
export const COMPLETED_QUERY_ERROR = 'Field "completed" must be "true" or "false".';
export const PRIORITY_ERROR = `Field "priority" must be one of: ${PRIORITIES.join(', ')}.`;
export const DUE_DATE_ERROR =
  'Field "due_date" must be a valid date in YYYY-MM-DD format or null.';
export const PATCH_EMPTY_ERROR =
  'Provide at least one of "title", "completed", "priority" or "due_date" to update.';
export const BODY_OBJECT_ERROR = 'Request body must be a JSON object.';
export const MAX_BULK_IDS = 500;
export const BULK_IDS_ERROR =
  'Field "ids" is required and must be a non-empty array of positive integers.';
export const BULK_IDS_TOO_MANY_ERROR = `Field "ids" must contain at most ${MAX_BULK_IDS} ids.`;
export const BULK_IDS_ITEM_ERROR = 'Each id in "ids" must be a positive integer.';

/**
 * True when `s` is a real calendar date in strict `YYYY-MM-DD` form. The
 * round-trip check rejects impossible dates such as 2026-02-30 or 2026-13-01.
 */
export function isValidDateOnly(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Priority value (case-sensitive). */
const priority = z.enum(PRIORITIES as readonly [Priority, ...Priority[]], {
  error: PRIORITY_ERROR,
});

/** Optional calendar date `YYYY-MM-DD`; `null` clears it. */
const dueDate = z
  .string({ error: DUE_DATE_ERROR })
  .refine(isValidDateOnly, { error: DUE_DATE_ERROR })
  .nullable()
  .optional();

/** POST /tasks body. Unknown keys are ignored. */
export const createTaskSchema = z.object(
  {
    title: z
      .string({ error: TITLE_REQUIRED_ERROR })
      .trim()
      .min(1, { error: TITLE_REQUIRED_ERROR }),
    priority: priority.optional(),
    due_date: dueDate,
  },
  { error: BODY_OBJECT_ERROR },
);

/** PATCH /tasks/:id body. At least one known field is required. */
export const updateTaskSchema = z
  .object(
    {
      title: z
        .string({ error: TITLE_ERROR })
        .trim()
        .min(1, { error: TITLE_ERROR })
        .optional(),
      completed: z.boolean({ error: COMPLETED_BOOL_ERROR }).optional(),
      priority: priority.optional(),
      due_date: dueDate,
    },
    { error: BODY_OBJECT_ERROR },
  )
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    error: PATCH_EMPTY_ERROR,
  });

/** GET /tasks query. Repeated or empty values are rejected; unknown params ignored. */
export const listQuerySchema = z.object({
  completed: z.enum(['true', 'false'], { error: COMPLETED_QUERY_ERROR }).optional(),
  priority: priority.optional(),
});

/** A single bulk id: positive safe integer of type number (no coercion). */
const bulkId = z
  .number({ error: BULK_IDS_ITEM_ERROR })
  .refine((n) => Number.isSafeInteger(n) && n > 0, { error: BULK_IDS_ITEM_ERROR });

/** POST /tasks/bulk-complete body. Length errors are reported before item errors. */
export const bulkCompleteSchema = z.object(
  {
    ids: z
      .array(z.unknown(), { error: BULK_IDS_ERROR })
      .min(1, { error: BULK_IDS_ERROR })
      .max(MAX_BULK_IDS, { error: BULK_IDS_TOO_MANY_ERROR })
      .pipe(z.array(bulkId)),
  },
  { error: BODY_OBJECT_ERROR },
);

/** Validation error response body. */
export interface ValidationErrorBody {
  error: string;
  details: { field: string | null; message: string }[];
}

/** Turn a ZodError into the API's 400 body: first issue as `error`, all as `details`. */
export function formatZodError(err: z.ZodError): ValidationErrorBody {
  return {
    error: err.issues[0].message,
    details: err.issues.map((i) => ({
      field: i.path.length ? i.path.map(String).join('.') : null,
      message: i.message,
    })),
  };
}
