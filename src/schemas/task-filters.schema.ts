import { z } from 'zod';
import { PRIORITIES } from '../types.js';
import { formatZodErrors, type FieldError } from './validation-errors.js';

const completedHelp = 'Use "true", "false", or "true,false", in lowercase, without spaces or empty list items. Example: completed=false.';
const priorityHelp = 'Use one or more of "low", "medium", or "high", separated by commas, in lowercase, without spaces or empty list items. Example: priority=low,high.';

function singleParameter(field: string, example: string) {
  return z.array(z.string()).length(1, {
    error: `Query parameter "${field}" must appear only once. Use a comma-separated list instead. Example: ${example}.`,
  }).transform(occurrences => occurrences[0].split(','));
}

function uniqueSelections(field: string, example: string) {
  return (values: string[], ctx: z.RefinementCtx) => {
    if (new Set(values).size !== values.length) {
      ctx.addIssue({
        code: 'custom',
        message: `Query parameter "${field}" must not repeat values. Include each selected value once. Example: ${example}.`,
      });
    }
  };
}

const filtersSchema = z.strictObject({
  completed: singleParameter('completed', 'completed=true,false')
    .pipe(z.array(z.enum(['true', 'false'], {
      error: `Query parameter "completed" contains an invalid value. ${completedHelp}`,
    })))
    .superRefine(uniqueSelections('completed', 'completed=true,false'))
    .transform(values => values.map(value => value === 'true'))
    .optional(),
  priority: singleParameter('priority', 'priority=low,high')
    .pipe(z.array(z.enum(PRIORITIES, {
      error: `Query parameter "priority" contains an invalid value. ${priorityHelp}`,
    })))
    .superRefine(uniqueSelections('priority', 'priority=low,high'))
    .optional(),
});

export function validateTaskFilterQuery(rawQuery: string) {
  // Read every occurrence before Express can merge, reshape, or discard keys.
  const occurrences = new Map<string, string[]>();
  for (const [field, value] of new URLSearchParams(rawQuery)) {
    const values = occurrences.get(field) ?? [];
    values.push(value);
    occurrences.set(field, values);
  }
  return filtersSchema.safeParse(Object.fromEntries(occurrences));
}

export function taskFilterErrors(error: z.ZodError): FieldError[] {
  return formatZodErrors(error, ['completed', 'priority'],
    field => `Query parameter "${field}" is not allowed. Use only "completed" and "priority", each once with comma-separated values. Example: completed=false&priority=low,high.`);
}
