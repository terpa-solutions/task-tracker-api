import type { Response } from 'express';
import type { z } from 'zod';

export interface ValidationErrorBody {
  error: string;
  details: { path: string; message: string }[];
}

/**
 * Send a 400 with one entry per Zod issue. `path` is the dotted location of
 * the offending value (e.g. "ids.2"), or "" for errors about the whole input.
 */
export function sendValidationError(
  res: Response,
  error: z.ZodError,
  message = 'Invalid request.',
): Response<ValidationErrorBody> {
  return res.status(400).json({
    error: message,
    details: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
}
