import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { ApiError } from '../../shared/api-error.js';
import { sendSuccess } from '../../shared/api-response.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { validateRequest } from '../../shared/validate-request.js';
import { campaignService } from '../campaigns/campaign.service.js';
import { discoveryService } from './discovery.service.js';

const runDiscoverySchema = z.object({
  body: z.object({
    campaignId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
  }),
});

export const discoveryRouter = Router();

discoveryRouter.use(authenticate);

discoveryRouter.post(
  '/run',
  validateRequest(runDiscoverySchema),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new ApiError(401, 'Authentication required', 'AUTH_REQUIRED');
    }

    // Ownership check — the service itself takes a raw campaign id.
    await campaignService.getById(req.body.campaignId, req.user.id);

    const stats = await discoveryService.runDiscovery(req.body.campaignId);
    sendSuccess(res, { message: 'Discovery complete', data: stats });
  }),
);
