import { z } from 'zod';
import { PRIORITIES } from './types.js';

/**
 * Field validators shared by every endpoint, so the create, update and query
 * schemas cannot drift apart. `z.iso.date()` checks the calendar, not just the
 * shape: 2026-13-45 and 2026-02-30 are rejected.
 */
const prioritySchema = z.enum(PRIORITIES);
const dueDateSchema = z.iso.date();
const titleSchema = z.string().trim().min(1);

/** Body of POST /tasks. Missing optional fields fall back to the DB defaults. */
export const createTaskSchema = z.object({
  title: titleSchema,
  priority: prioritySchema.default('medium'),
  due_date: dueDateSchema.nullable().default(null),
});

/**
 * Body of PATCH /tasks/:id. Every field is optional, but at least one must be
 * present. A `due_date` of null is meaningful: it clears the date.
 */
export const updateTaskSchema = z
  .object({
    title: titleSchema.optional(),
    completed: z.boolean().optional(),
    priority: prioritySchema.optional(),
    due_date: dueDateSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message:
      'Provide at least one of "title", "completed", "priority" or "due_date" to update.',
  });

/**
 * Body of POST /tasks/bulk-complete. The upper bound keeps an oversized
 * payload from blowing past SQLite's bound-variable limit, which would surface
 * as a driver crash instead of a clear 400.
 */
export const bulkCompleteSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
});

/** Query string of GET /tasks. Both filters are optional and combinable. */
export const listQuerySchema = z.object({
  completed: z.enum(['true', 'false']).optional(),
  priority: prioritySchema.optional(),
});

/** Turn a Zod failure into the flat 400 body the API returns everywhere. */
export function toErrorResponse(error: z.ZodError): {
  error: string;
  details: string[];
} {
  return {
    error: 'Invalid request.',
    details: error.issues.map((issue) =>
      issue.path.length > 0
        ? `${issue.path.join('.')}: ${issue.message}`
        : issue.message,
    ),
  };
}
