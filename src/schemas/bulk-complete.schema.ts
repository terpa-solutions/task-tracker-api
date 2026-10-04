import { z } from 'zod';
import { createScanner, SyntaxKind } from 'jsonc-parser';
import { MAX_TASK_ID } from '../task-id.js';
import { bodyValidationErrors, type FieldError } from './validation-errors.js';

export const MAX_BULK_TASKS = 500;
const example = 'Example: {"ids":[1,2]}.';
const idHelp = `Field "ids" must contain integer numbers from 1 through ${MAX_TASK_ID}, without strings or null. ${example}`;
const idsSchema = z.array(z.number({ error: idHelp }).int({ error: idHelp }).min(1, { error: idHelp }).max(MAX_TASK_ID, { error: idHelp }), {
  error: `Field "ids" is required and must be an array of task IDs. ${example}`,
}).min(1, { error: `Field "ids" must contain at least one task ID. ${example}` })
  .max(MAX_BULK_TASKS, { error: `Field "ids" must contain at most ${MAX_BULK_TASKS} task IDs. Split larger requests into separate batches.` })
  .superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: `Field "ids" must not repeat IDs. Include each task ID once. ${example}` });
    }
  });
const bulkSchema = z.strictObject({ ids: idsSchema }, { error: 'The request body must be a JSON object.' });
const literalSchema = z.string().regex(/^[1-9][0-9]*$/);

type BulkValidation = { success: true; data: { ids: number[] } } | { success: false; errors: FieldError[] };

/** Inspect only the top-level ids array; unrelated values never become IDs. */
function originalIds(source: string) {
  const scanner = createScanner(source, true);
  const literals: string[] = [];
  let depth = 0;
  let key = '';
  let property = '';
  let occurrences = 0;
  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken) depth++;
    else if (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken) depth--;
    else if (token === SyntaxKind.StringLiteral && depth === 1) key = scanner.getTokenValue();
    else if (token === SyntaxKind.ColonToken && depth === 1) {
      property = key;
      if (property === 'ids') occurrences++;
    } else if (token === SyntaxKind.NumericLiteral && depth === 2 && property === 'ids') {
      literals.push(source.slice(scanner.getTokenOffset(), scanner.getTokenOffset() + scanner.getTokenLength()));
    }
  }
  return { literals, occurrences };
}

export function validateBulkComplete(body: unknown, source: string | undefined): BulkValidation {
  const parsed = bulkSchema.safeParse(body);
  const errors: FieldError[] = parsed.success ? [] : bodyValidationErrors(parsed.error);
  if (!parsed.success) {
    const itemIssue = parsed.error.issues.find(issue => issue.path[0] === 'ids' && typeof issue.path[1] === 'number');
    if (itemIssue) {
      const idsError = errors.find(error => error.field === 'ids');
      if (idsError) idsError.message += ` Invalid item at index ${String(itemIssue.path[1])} (zero-based).`;
    }
  }
  // Check the original spelling even if another property is unknown, so the
  // response reports both problems. Shape/range errors already produce one ids error.
  const ids = parsed.success ? parsed.data.ids : (
    body !== null && typeof body === 'object' && !Array.isArray(body) && Object.hasOwn(body, 'ids')
      ? idsSchema.safeParse((body as Record<string, unknown>).ids).data : undefined
  );
  const original = source !== undefined && body !== null && typeof body === 'object' && !Array.isArray(body)
    ? originalIds(source) : undefined;
  const repeatedProperty = { field: 'ids', message: `Field "ids" must appear exactly once. ${example}` };
  if (original && original.occurrences > 1) {
    // JSON.parse keeps only the last duplicate property, even if that value is
    // invalid. Report the ambiguous property before validating its final value.
    const position = errors.findIndex(error => error.field === 'ids');
    if (position === -1) errors.unshift(repeatedProperty);
    else errors[position] = repeatedProperty;
  } else if (ids) {
    if (source === undefined) {
      errors.unshift({ field: 'body', message: 'Send a JSON body with Content-Type: application/json.' });
    } else {
      // Express checks JSON syntax. Zod checks values. The scanner preserves the
      // raw numerals, including digits that JSON.parse may already have rounded.
      const { literals, occurrences } = original!;
      const invalidIndex = literals.findIndex(literal => !literalSchema.safeParse(literal).success);
      if (occurrences !== 1 || literals.length !== ids.length) {
        errors.unshift(repeatedProperty);
      } else if (invalidIndex !== -1) {
        errors.unshift({ field: 'ids', message: `Field "ids" must use decimal digits only, without signs, fractions, or exponents. Invalid item at index ${invalidIndex} (zero-based). ${example}` });
      }
    }
  }
  if (!parsed.success || errors.length !== 0) return { success: false, errors };
  return { success: true, data: parsed.data };
}
