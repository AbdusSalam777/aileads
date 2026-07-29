import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { ApiError } from '../../shared/api-error.js';
import { sendSuccess } from '../../shared/api-response.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { validateRequest } from '../../shared/validate-request.js';
import { analyticsService } from './analytics.service.js';

const timeseriesSchema = z.object({
  query: z.object({ days: z.coerce.number().int().min(7).max(90).optional() }),
});

export const analyticsRouter = Router();

analyticsRouter.use(authenticate);

const requireUserId = (req: { user?: { id: string } }) => {
  if (!req.user) {
    throw new ApiError(401, 'Authentication required', 'AUTH_REQUIRED');
  }

  return req.user.id;
};

analyticsRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    sendSuccess(res, { data: await analyticsService.overview(requireUserId(req)) });
  }),
);

analyticsRouter.get(
  '/timeseries',
  validateRequest(timeseriesSchema),
  asyncHandler(async (req, res) => {
    const days = Number(req.query.days ?? 30);
    sendSuccess(res, { data: await analyticsService.timeseries(requireUserId(req), days) });
  }),
);
