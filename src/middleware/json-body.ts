import type { IncomingMessage, ServerResponse } from 'node:http';

// Keep the original bytes until the bulk controller checks the numeric spelling.
// Other endpoints retain Express's normal JSON values and validation behavior.
const sources = new WeakMap<IncomingMessage, { buffer: Buffer; encoding: string }>();

export function captureJsonSource(req: IncomingMessage, _res: ServerResponse, buffer: Buffer, encoding: string): void {
  sources.set(req, { buffer, encoding });
}

export function takeJsonSource(req: IncomingMessage): string | undefined {
  const source = sources.get(req);
  sources.delete(req);
  if (!source) return undefined;
  try {
    return new TextDecoder(source.encoding).decode(source.buffer);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw Object.assign(new Error('Unsupported JSON charset for original-number validation.'), {
      type: 'charset.unsupported', status: 415,
    });
  }
}
