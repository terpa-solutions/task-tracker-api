import { z } from 'zod';
import { PRIORITIES } from '../types.js';
import { dueDateSchema } from './due-date.schema.js';

export { bodyValidationErrors as taskValidationErrors, type FieldError } from './validation-errors.js';

const bodyMessage = 'The request body must be a JSON object.';
const titleMessage = 'Field "title" must be a non-empty string; it is required when creating a task.';
const emptyPatchMessage = 'Provide at least one of "title", "completed", "priority", or "due_date" to update.';

function prioritySchema(operation: 'create' | 'update') {
  const omission = operation === 'create'
    ? ' Omit "priority" when creating a task to use "medium".'
    : ' Omit "priority" when updating to keep its current value.';
  return z.enum(PRIORITIES, {
    error: 'Field "priority" must be exactly "low", "medium", or "high", in lowercase with no spaces.' + omission,
  });
}

export function validateCreateTask(body: unknown, now = new Date()) {
  return z.strictObject({
    title: z.string({ error: titleMessage }).trim().min(1, { error: titleMessage }),
    priority: prioritySchema('create').default('medium'),
    due_date: dueDateSchema('create', now).default(null),
  }, { error: bodyMessage }).safeParse(body);
}

export function validateUpdateTask(body: unknown, now = new Date()) {
  const emptyBody = body !== null && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0;
  return z.strictObject({
    title: z.string({ error: titleMessage }).trim().min(1, { error: titleMessage }).optional(),
    completed: z.boolean({ error: 'Field "completed" must be a boolean: true or false.' }).optional(),
    priority: prioritySchema('update').optional(),
    due_date: dueDateSchema('update', now).optional(),
  }, { error: bodyMessage }).refine(() => !emptyBody, {
    error: emptyPatchMessage,
  }).safeParse(body);
}
