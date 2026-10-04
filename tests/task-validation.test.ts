import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { validateCreateTask, validateUpdateTask, taskValidationErrors } from '../src/schemas/tasks.schema.js';
import { validateTaskFilterQuery, taskFilterErrors } from '../src/schemas/task-filters.schema.js';
import { validateBulkComplete } from '../src/schemas/bulk-complete.schema.js';

const now = new Date(2030, 0, 2, 15, 0, 0);
const validators = [validateCreateTask, validateUpdateTask];

test('POST distingue ausencia de fecha de otros espacios y aplica los valores predeterminados', () => {
  for (const extra of [{}, { due_date: null }, { due_date: '' }, { due_date: '   ' }]) {
    const result = validateCreateTask({ title: '  Date test  ', ...extra }, now);
    assert.equal(result.success, true);
    if (result.success) assert.deepEqual(result.data, { title: 'Date test', priority: 'medium', due_date: null });
  }
  for (const due_date of ['\t', '\n', '\r', '\u00a0', ' \t ']) {
    const result = validateCreateTask({ title: 'Date test', due_date }, now);
    assert.equal(result.success, false);
    if (!result.success) {
      const errors = taskValidationErrors(result.error);
      assert.deepEqual(errors.map(error => error.field), ['due_date']);
      assert.match(errors[0].message, /ASCII spaces only/);
    }
  }
});

test('PATCH conserva la omisión, permite borrar la fecha y rechaza espacios ASCII', () => {
  const omitted = validateUpdateTask({ title: 'Renamed' }, now);
  assert.equal(omitted.success, true);
  if (omitted.success) assert.deepEqual(omitted.data, { title: 'Renamed' });
  for (const due_date of [null, '']) {
    const cleared = validateUpdateTask({ due_date }, now);
    assert.equal(cleared.success, true);
    if (cleared.success) assert.deepEqual(cleared.data, { due_date: null });
  }
  const spaces = validateUpdateTask({ title: 'Renamed', due_date: '   ' }, now);
  assert.equal(spaces.success, false);
  if (!spaces.success) assert.deepEqual(taskValidationErrors(spaces.error), [{
    field: 'due_date',
    message: 'Field "due_date" must be a string in YYYY-MM-DD HH:mm:ss format, without a timezone, fractional seconds, surrounding spaces, tabs, or line breaks. Send null or an empty string to remove the date; omit "due_date" to keep it. Spaces-only strings are not allowed.',
  }]);
});

test('el reloj recibido acepta cualquier hora de hoy y distingue el día anterior', () => {
  for (const validate of validators) {
    for (const due_date of ['2030-01-02 00:00:00', '2030-01-02 10:00:00', '2030-01-02 23:59:59', '2030-01-03 00:00:00']) {
      const result = validate({ title: 'Date test', due_date }, now);
      assert.equal(result.success, true, due_date);
      if (result.success) assert.equal(result.data.due_date, due_date);
    }
    const past = validate({ title: 'Date test', due_date: '2030-01-01 23:59:59' }, now);
    assert.equal(past.success, false);
    if (!past.success) assert.deepEqual(taskValidationErrors(past.error), [{
      field: 'due_date',
      message: 'Field "due_date" must fall on today or a future day, based on the API machine\'s local date. Use YYYY-MM-DD HH:mm:ss.',
    }]);
  }
});

test('el calendario y la hora rechazan fechas imposibles sin normalizarlas', () => {
  for (const validate of validators) {
    for (const due_date of ['2032-02-29 12:00:00', '2400-02-29 23:59:59', '2100-02-28 00:00:00']) {
      assert.equal(validate({ title: 'Date test', due_date }, now).success, true, due_date);
    }
    for (const due_date of [
      '2031-02-29 12:00:00', '2100-02-29 12:00:00', '2030-04-31 12:00:00',
      '2030-00-01 12:00:00', '2030-13-01 12:00:00', '2030-01-00 12:00:00',
      '2030-01-32 12:00:00', '2030-01-02 24:00:00', '2030-01-02 12:60:00', '2030-01-02 12:00:60',
    ]) {
      const result = validate({ title: 'Date test', due_date }, now);
      assert.equal(result.success, false, due_date);
      if (!result.success) assert.deepEqual(taskValidationErrors(result.error), [{
        field: 'due_date', message: 'Field "due_date" must contain a valid calendar date and time in YYYY-MM-DD HH:mm:ss format.',
      }]);
    }
  }
});

test('el formato exige espacio, segundos enteros y ningún ajuste de zona horaria', () => {
  for (const validate of validators) {
    for (const due_date of [
      0, false, [], {}, '2030-01-02T12:00:00', '2030-01-02 12:00:00Z', '2030-01-02 12:00:00-06:00',
      '2030-01-02 12:00:00.001', '2030-01-02 12:00', '2030-1-02 12:00:00',
      ' 2030-01-02 12:00:00', '2030-01-02 12:00:00 ', '2030-01-02 12:00:00\n',
    ]) {
      const result = validate({ title: 'Date test', due_date }, now);
      assert.equal(result.success, false, String(due_date));
      if (!result.success) {
        const errors = taskValidationErrors(result.error);
        assert.deepEqual(errors.map(error => error.field), ['due_date']);
        assert.match(errors[0].message, /YYYY-MM-DD HH:mm:ss format, without a timezone, fractional seconds/);
      }
    }
  }
});

test('la misma marca de tiempo usa el día local en ambos lados de medianoche UTC', () => {
  const schemaUrl = new URL('../src/schemas/tasks.schema.ts', import.meta.url).href;
  const source = `
    import { validateCreateTask, validateUpdateTask } from ${JSON.stringify(schemaUrl)};
    const now = new Date('2030-01-02T02:00:00Z');
    const body = { title: 'Local day', due_date: '2030-01-01 23:59:59' };
    process.stdout.write(JSON.stringify([
      validateCreateTask(body, now).success,
      validateUpdateTask(body, now).success,
    ]));
  `;
  for (const [timezone, expected] of [['Etc/GMT+6', true], ['Etc/GMT-14', false]] as const) {
    const output = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
      cwd: new URL('../', import.meta.url), env: { ...process.env, TZ: timezone }, windowsHide: true, encoding: 'utf8', stdio: 'pipe',
    });
    assert.deepEqual(JSON.parse(output), [expected, expected], timezone);
  }
});

test('los errores del cuerpo mantienen mensajes, orden y una entrada por campo', () => {
  const body = { zzz: 1, due_date: 'bad', priority: 'HIGH', completed: 'false', title: '', aaa: 2 };
  const result = validateUpdateTask(body, now);
  assert.equal(result.success, false);
  if (!result.success) {
    const errors = taskValidationErrors(result.error);
    assert.deepEqual(errors.map(error => error.field), ['title', 'completed', 'priority', 'due_date', 'aaa', 'zzz']);
    assert.equal(errors[0].message, 'Field "title" must be a non-empty string; it is required when creating a task.');
    assert.equal(errors[1].message, 'Field "completed" must be a boolean: true or false.');
    assert.equal(errors[2].message, 'Field "priority" must be exactly "low", "medium", or "high", in lowercase with no spaces. Omit "priority" when updating to keep its current value.');
    assert.deepEqual(errors.slice(-2), [
      { field: 'aaa', message: 'Field "aaa" is not allowed in this operation.' },
      { field: 'zzz', message: 'Field "zzz" is not allowed in this operation.' },
    ]);
  }
  const nonObject = validateCreateTask(null, now);
  assert.equal(nonObject.success, false);
  if (!nonObject.success) assert.deepEqual(taskValidationErrors(nonObject.error), [
    { field: 'body', message: 'The request body must be a JSON object.' },
  ]);
});

test('los errores de filtros agrupan valores inválidos y conservan instrucciones y orden', () => {
  const result = validateTaskFilterQuery('zzz=1&priority=urgent,HIGH&completed=TRUE,0&aaa=2');
  assert.equal(result.success, false);
  if (!result.success) assert.deepEqual(taskFilterErrors(result.error), [
    { field: 'completed', message: 'Query parameter "completed" contains an invalid value. Use "true", "false", or "true,false", in lowercase, without spaces or empty list items. Example: completed=false.' },
    { field: 'priority', message: 'Query parameter "priority" contains an invalid value. Use one or more of "low", "medium", or "high", separated by commas, in lowercase, without spaces or empty list items. Example: priority=low,high.' },
    { field: 'aaa', message: 'Query parameter "aaa" is not allowed. Use only "completed" and "priority", each once with comma-separated values. Example: completed=false&priority=low,high.' },
    { field: 'zzz', message: 'Query parameter "zzz" is not allowed. Use only "completed" and "priority", each once with comma-separated values. Example: completed=false&priority=low,high.' },
  ]);
});

test('el lote conserva la escritura original, el índice y la precedencia de ids repetido', () => {
  for (const source of ['{"ids":[2,3.0]}', '{"ids":[2,3e0]}', '{"ids":[2,3.0000000000000001]}']) {
    const result = validateBulkComplete(JSON.parse(source), source);
    assert.deepEqual(result, { success: false, errors: [{
      field: 'ids', message: 'Field "ids" must use decimal digits only, without signs, fractions, or exponents. Invalid item at index 1 (zero-based). Example: {"ids":[1,2]}.',
    }] });
  }
  for (const source of ['{"ids":[2],"ids":[]}', '{"ids":[2],"ids":["3"]}', '{"ids":[2],"ids":null}']) {
    assert.deepEqual(validateBulkComplete(JSON.parse(source), source), { success: false, errors: [{
      field: 'ids', message: 'Field "ids" must appear exactly once. Example: {"ids":[1,2]}.',
    }] });
  }
  const source = '{"zzz":1,"ids":[2,"3",false],"aaa":2}';
  assert.deepEqual(validateBulkComplete(JSON.parse(source), source), { success: false, errors: [
    { field: 'ids', message: 'Field "ids" must contain integer numbers from 1 through 500000, without strings or null. Example: {"ids":[1,2]}. Invalid item at index 1 (zero-based).' },
    { field: 'aaa', message: 'Field "aaa" is not allowed in this operation.' },
    { field: 'zzz', message: 'Field "zzz" is not allowed in this operation.' },
  ] });
});
