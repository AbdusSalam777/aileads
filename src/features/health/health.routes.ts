import { Router } from 'express';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/api-response.js';

export const healthRouter = Router();

healthRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, {
      data: {
        status: 'ok',
        service: 'ai-leads-api',
        timestamp: new Date().toISOString(),
      },
    });
  }),
);
