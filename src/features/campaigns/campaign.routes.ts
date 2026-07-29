import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { validateRequest } from '../../shared/validate-request.js';
import { campaignController } from './campaign.controller.js';
import {
  campaignIdSchema,
  createCampaignSchema,
  listCampaignsSchema,
  updateCampaignSchema,
} from './campaign.schemas.js';

export const campaignRouter = Router();

campaignRouter.use(authenticate);

campaignRouter.get('/', validateRequest(listCampaignsSchema), asyncHandler(campaignController.list));
campaignRouter.post('/', validateRequest(createCampaignSchema), asyncHandler(campaignController.create));
campaignRouter.get('/:id', validateRequest(campaignIdSchema), asyncHandler(campaignController.get));
campaignRouter.patch(
  '/:id',
  validateRequest(updateCampaignSchema),
  asyncHandler(campaignController.update),
);
campaignRouter.delete(
  '/:id',
  validateRequest(campaignIdSchema),
  asyncHandler(campaignController.remove),
);
