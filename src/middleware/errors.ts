import type { ErrorRequestHandler, Request, Response } from 'express';

/** Fallback for unmatched routes: JSON 404 instead of Express's HTML page. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
}

/**
 * Global error handler: body-parser errors become JSON 4xx; anything else is
 * logged and returned as a generic 500 (no stack trace leaked).
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON body.' });
    return;
  }

  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body too large.' });
    return;
  }

  const status = typeof err?.status === 'number' ? err.status : undefined;
  if (status !== undefined && status >= 400 && status <= 499) {
    res.status(status).json({ error: 'Invalid request body.' });
    return;
  }

  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
};
