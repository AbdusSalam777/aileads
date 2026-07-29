import type { RequestHandler } from 'express';
import { ApiError } from '../shared/api-error.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND'));
};
