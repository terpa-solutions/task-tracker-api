export const MAX_TASK_ID = 500000;

export class TaskIdRangeError extends RangeError {
  constructor() {
    super(`Database task id is outside the supported range 1..${MAX_TASK_ID}.`);
    this.name = 'TaskIdRangeError';
  }
}

/** Validate the original decimal spelling before converting it to a number. */
export function parseTaskId(raw: string): number | null {
  if (!/^[0-9]+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_TASK_ID ? value : null;
}

/** Read SQLite integers exactly first; never expose a rounded identifier. */
export function taskIdNumber(value: number | bigint): number {
  if (typeof value === 'bigint') {
    if (value > 0n && value <= BigInt(MAX_TASK_ID)) return Number(value);
  } else if (Number.isSafeInteger(value) && value > 0 && value <= MAX_TASK_ID) {
    return value;
  }
  throw new TaskIdRangeError();
}
