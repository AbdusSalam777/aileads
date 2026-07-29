import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { ApiError } from '../shared/api-error.js';
import { sendError } from '../shared/api-response.js';
import { logger } from '../shared/logger.js';

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next;
  const normalizedError =
    error instanceof ZodError
      ? new ApiError(422, 'Validation failed', 'VALIDATION_ERROR', error.flatten())
      : error instanceof ApiError
      ? error
      : new ApiError(500, 'Internal server error', undefined, error);

  if (normalizedError.statusCode >= 500) {
    logger.error({ error }, normalizedError.message);
  }

  sendError(res, {
    statusCode: normalizedError.statusCode,
    message: normalizedError.message,
    code: normalizedError.code,
    details: env.NODE_ENV === 'production' ? undefined : normalizedError.details,
  });
};
