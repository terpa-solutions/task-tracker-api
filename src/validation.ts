import { z } from 'zod';

/** Shared enum for the three priority levels used across multiple schemas. */
const Priority = z.enum(['low', 'medium', 'high']);

/**
 * Schema for POST /tasks.
 * `priority` defaults to 'medium' when omitted.
 * `due_date` must be ISO 8601 date (YYYY-MM-DD) when provided.
 */
export const CreateTaskSchema = z.object({
  title: z.string().min(1, '"title" must be a non-empty string'),
  priority: Priority.default('medium'),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '"due_date" must be YYYY-MM-DD')
    .nullable()
    .optional(),
});

/**
 * Schema for PATCH /tasks/:id.
 * All fields are optional, but at least one must be present.
 */
export const UpdateTaskSchema = z
  .object({
    title: z.string().min(1, '"title" must be a non-empty string').optional(),
    completed: z.boolean().optional(),
    priority: Priority.optional(),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '"due_date" must be YYYY-MM-DD')
      .nullable()
      .optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Provide at least one of "title", "completed", "priority", or "due_date" to update.',
  });

/**
 * Schema for POST /tasks/bulk-complete.
 * Requires a non-empty array of positive integers.
 */
export const BulkCompleteSchema = z.object({
  ids: z
    .array(z.number().int().positive())
    .min(1, '"ids" must be a non-empty array of positive integers'),
});

/**
 * Schema for GET /tasks query parameters.
 * Both filters are optional and can be combined.
 */
export const TaskQuerySchema = z.object({
  completed: z.enum(['true', 'false']).optional(),
  priority: Priority.optional(),
});

/** Flatten Zod validation errors into a single `{ error: string }` response body. */
export function zodError(e: z.ZodError) {
  return { error: e.errors.map((i) => i.message).join('; ') };
}
