import type { ErrorRequestHandler } from 'express';

const parserErrors: Record<string, { status: number; message: string }> = {
  'entity.parse.failed': { status: 400, message: 'Invalid JSON. Use double quotes and remove trailing commas.' },
  'entity.too.large': { status: 413, message: 'Request body is too large. Maximum size is 100 KB.' },
  'charset.unsupported': { status: 415, message: 'Unsupported request encoding. Use UTF-8 JSON with a supported content encoding.' },
  'encoding.unsupported': { status: 415, message: 'Unsupported request encoding. Use UTF-8 JSON with a supported content encoding.' },
  'request.size.invalid': { status: 400, message: 'Invalid request body length. Send a complete JSON body with a correct Content-Length.' },
  'request.aborted': { status: 400, message: 'The request body was interrupted. Send the complete JSON body again.' },
};

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof Error) {
    const details = error as Error & { type?: unknown; status?: unknown; statusCode?: unknown; code?: unknown };
    // Express 4 marks decode_param failures with this URIError message and both statuses.
    // Other URIError instances remain internal failures.
    if (error instanceof URIError && details.status === 400 && details.statusCode === 400
      && /^Failed to decode param '[\s\S]*'$/.test(error.message)) {
      return res.status(400).json({ error: 'Invalid URL encoding. Use a valid percent-encoded task ID.' });
    }
    const known = typeof details.type === 'string' && Object.hasOwn(parserErrors, details.type)
      ? parserErrors[details.type] : undefined;
    if (known && details.status === known.status) {
      return res.status(known.status).json({ errors: [{ field: 'body', message: known.message }] });
    }
    // A damaged compressed body fails before JSON parsing and is still a client error.
    if (details.status === 400 && (details.code === 'Z_DATA_ERROR' || details.code === 'Z_BUF_ERROR')) {
      return res.status(400).json({ errors: [{ field: 'body', message: 'Invalid encoded request body. Send valid JSON with the correct Content-Encoding.' }] });
    }
  }
  // Log the cause on the server, without copying request bodies into diagnostics.
  console.error('Request failed', {
    method: req.method, path: req.path,
    cause: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : 'Unknown error',
  });
  res.status(500).json({ error: 'Internal server error.' });
};
