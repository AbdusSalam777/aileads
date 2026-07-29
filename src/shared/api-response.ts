import type { Response } from 'express';

type SuccessResponse<T> = {
  data: T;
  message?: string;
  statusCode?: number;
  meta?: Record<string, unknown>;
};

type ErrorResponse = {
  statusCode: number;
  message: string;
  code?: string;
  details?: unknown;
};

export const sendSuccess = <T>(res: Response, payload: SuccessResponse<T>) => {
  const { statusCode = 200, message = 'Success', data, meta } = payload;

  return res.status(statusCode).json({
    success: true,
    message,
    data,
    meta,
  });
};

export const sendError = (res: Response, payload: ErrorResponse) => {
  return res.status(payload.statusCode).json({
    success: false,
    message: payload.message,
    code: payload.code,
    details: payload.details,
  });
};
