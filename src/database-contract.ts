import type { Database } from 'better-sqlite3';
import { MAX_TASK_ID } from './task-id.js';

export interface Column {
  [key: string]: unknown;
  name: string;
  type: string;
  notnull: number | bigint;
  dflt_value: string | null;
  hidden: number | bigint;
}

export class DatabaseContractError extends Error {
  constructor(message: string, public readonly details: Record<string, unknown>) {
    super(message);
    this.name = 'DatabaseContractError';
  }
}

export function taskColumns(db: Database): Column[] {
  // table_info excludes generated columns; xinfo includes their metadata.
  return db.prepare('PRAGMA table_xinfo(tasks)').safeIntegers(true).all() as Column[];
}

type Token = { kind: 'word' | 'identifier' | 'string' | 'symbol'; value: string };

/** Read SQLite tokens without treating comments or quoted text as constraints. */
function sqlTokens(sql: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < sql.length;) {
    const char = sql[i];
    if (/\s/.test(char)) { i++; continue; }
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i + 2);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (['\'', '"', '`', '['].includes(char)) {
      const endQuote = char === '[' ? ']' : char;
      let value = '';
      i++;
      while (i < sql.length) {
        if (sql[i] === endQuote) {
          if (char !== '[' && sql[i + 1] === endQuote) { value += endQuote; i += 2; continue; }
          i++;
          break;
        }
        value += sql[i++];
      }
      tokens.push({ kind: char === '\'' ? 'string' : 'identifier', value });
      continue;
    }
    const word = /^[a-z_][a-z_0-9]*/i.exec(sql.slice(i));
    if (word) {
      tokens.push({ kind: 'word', value: word[0].toLowerCase() });
      i += word[0].length;
    } else {
      tokens.push({ kind: 'symbol', value: char });
      i++;
    }
  }
  return tokens;
}

function withoutOuterParens(tokens: Token[]): Token[] {
  while (tokens[0]?.value === '(' && tokens.at(-1)?.value === ')') {
    let depth = 0;
    let enclosesAll = true;
    for (let i = 0; i < tokens.length - 1; i++) {
      if (tokens[i].kind !== 'symbol') continue;
      if (tokens[i].value === '(') depth++;
      if (tokens[i].value === ')') depth--;
      if (depth === 0) { enclosesAll = false; break; }
    }
    if (!enclosesAll) break;
    tokens = tokens.slice(1, -1);
  }
  return tokens;
}

/** Recognize the supported IN declaration, not general SQL-equivalent constraints. */
function hasPriorityCheck(sql: string): boolean {
  const tokens = sqlTokens(sql);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== 'word' || tokens[i].value !== 'check' || tokens[i + 1]?.value !== '(') continue;
    let depth = 1;
    let end = i + 2;
    for (; end < tokens.length && depth; end++) {
      if (tokens[end].kind !== 'symbol') continue;
      if (tokens[end].value === '(') depth++;
      if (tokens[end].value === ')') depth--;
    }
    const expression = withoutOuterParens(tokens.slice(i + 2, end - 1));
    const [column, operator, open, a, comma1, b, comma2, c, close] = expression;
    if (expression.length !== 9 || !['word', 'identifier'].includes(column.kind) || column.value.toLowerCase() !== 'priority') continue;
    if (operator.kind !== 'word' || operator.value !== 'in' || open.value !== '(' || close.value !== ')') continue;
    if (comma1.value !== ',' || comma2.value !== ',' || [a, b, c].some((token) => token.kind !== 'string')) continue;
    if ([a.value, b.value, c.value].sort().join(',') === 'high,low,medium') return true;
  }
  return false;
}

function fail(field: string, expected: unknown, actual: unknown): never {
  throw new DatabaseContractError(`Esquema de tasks incompatible: ${field}.`, {
    table: 'tasks', field, expected, actual,
  });
}

function columnDeclaration(sql: string, name: string): Token[] {
  const tokens = sqlTokens(sql);
  let depth = 0;
  let start = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== 'symbol') continue;
    if (tokens[i].value === '(') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if ((tokens[i].value === ',' || tokens[i].value === ')') && depth === 1) {
      if (['word', 'identifier'].includes(tokens[start]?.kind) && tokens[start].value.toLowerCase() === name) {
        return tokens.slice(start, i);
      }
      start = i + 1;
    }
    if (tokens[i].value === ')') depth--;
  }
  return [];
}

/** Validate the supported declarations, including existing columns on repeated updates. */
export function assertTaskSchema(db: Database, allowMissingNewFields = false): void {
  const columns = taskColumns(db);
  const schema = db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'tasks'").get() as { sql: string } | undefined;
  for (const name of ['priority', 'due_date']) {
    const column = columns.find((item) => item.name.toLowerCase() === name);
    if (!column) {
      if (allowMissingNewFields) continue;
      throw new DatabaseContractError(`Falta tasks.${name}. Ejecuta npm run db:update antes de iniciar la API.`, {
        table: 'tasks', field: name, expected: 'columna existente', actual: null,
      });
    }
    if (column.name !== name) fail(name, name, column.name);
    if (column.type.trim().toUpperCase() !== 'TEXT' || Number(column.hidden) !== 0) {
      fail(name, 'columna TEXT ordinaria, no calculada', column);
    }
    const defaultTokens = withoutOuterParens(sqlTokens(column.dflt_value ?? 'NULL'));
    if (name === 'priority') {
      if (Number(column.notnull) !== 1 || defaultTokens.length !== 1 || defaultTokens[0].kind !== 'string' || defaultTokens[0].value !== 'medium') {
        fail(name, "TEXT NOT NULL DEFAULT 'medium'", column);
      }
      if (!schema || !hasPriorityCheck(schema.sql)) {
        fail(name, "CHECK (priority IN ('low', 'medium', 'high'))", schema?.sql ?? null);
      }
      // An implicit NOCASE/RTRIM collation could weaken an otherwise matching CHECK.
      const tokens = columnDeclaration(schema.sql, name);
      for (let i = 0; i < tokens.length - 1; i++) {
        if (tokens[i].kind === 'word' && tokens[i].value === 'collate' && tokens[i + 1].value.toLowerCase() !== 'binary') {
          fail(name, 'COLLATE BINARY (explícito o predeterminado)', tokens[i + 1].value);
        }
      }
    } else if (Number(column.notnull) !== 0 || defaultTokens.length !== 1 || defaultTokens[0].kind !== 'word' || defaultTokens[0].value !== 'null') {
      fail(name, 'TEXT nullable con DEFAULT NULL u omitido', column);
    }
  }
  if (columns.some((column) => column.name === 'priority')) {
    const invalid = db.prepare("SELECT CAST(id AS TEXT) AS id, priority FROM tasks WHERE typeof(priority) <> 'text' OR priority COLLATE BINARY NOT IN ('low','medium','high') LIMIT 1").get() as { id: string; priority: unknown } | undefined;
    if (invalid) fail('priority', 'low | medium | high', invalid);
  }
  if (columns.some((column) => column.name === 'due_date')) {
    const invalid = db.prepare("SELECT CAST(id AS TEXT) AS id, due_date FROM tasks WHERE due_date IS NOT NULL AND typeof(due_date) <> 'text' LIMIT 1").get();
    if (invalid) fail('due_date', 'text | null', invalid);
  }
}

export function assertTaskIds(db: Database): void {
  const invalid = db.prepare('SELECT id FROM tasks WHERE typeof(id) <> \'integer\' OR id <= 0 OR id > ? LIMIT 1')
    .safeIntegers(true).get(MAX_TASK_ID) as { id: unknown } | undefined;
  if (invalid) {
    throw new DatabaseContractError(`tasks.id está fuera del rango permitido de la API (1..${MAX_TASK_ID}).`, {
      table: 'tasks', field: 'id', expected: `1..${MAX_TASK_ID}`, actual: String(invalid.id),
    });
  }
}
