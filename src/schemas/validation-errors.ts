import type { z } from 'zod';

export interface FieldError {
  field: string;
  message: string;
}

/** Keep the first actionable issue per field, then append unknown keys in order. */
export function formatZodErrors(
  error: z.ZodError,
  fieldOrder: readonly string[],
  unknownFieldMessage: (field: string) => string,
): FieldError[] {
  const fields = new Map<string, FieldError>();
  const unknown = new Map<string, FieldError>();
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const field of issue.keys) {
        unknown.set(field, { field, message: unknownFieldMessage(field) });
      }
    } else {
      const field = String(issue.path[0] ?? 'body');
      if (!fields.has(field)) fields.set(field, { field, message: issue.message });
    }
  }
  return [
    ...[...fields.values()].sort((a, b) => fieldOrder.indexOf(a.field) - fieldOrder.indexOf(b.field)),
    ...[...unknown.keys()].sort().map(field => unknown.get(field)!),
  ];
}

export function bodyValidationErrors(error: z.ZodError): FieldError[] {
  return formatZodErrors(error, ['title', 'completed', 'priority', 'due_date'],
    field => `Field "${field}" is not allowed in this operation.`);
}
