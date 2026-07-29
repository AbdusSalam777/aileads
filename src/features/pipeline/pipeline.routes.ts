import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { sendSuccess } from '../../shared/api-response.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { validateRequest } from '../../shared/validate-request.js';
import { draftingService } from '../drafting/drafting.service.js';
import { qualificationService } from '../qualification/qualification.service.js';

const limitSchema = z.object({
  body: z.object({ limit: z.coerce.number().int().positive().max(50).optional() }),
});

export const pipelineRouter = Router();

pipelineRouter.use(authenticate);

pipelineRouter.post(
  '/qualify',
  validateRequest(limitSchema),
  asyncHandler(async (req, res) => {
    const stats = await qualificationService.runQualification(req.body.limit);
    sendSuccess(res, { message: 'Qualification complete', data: stats });
  }),
);

pipelineRouter.post(
  '/draft',
  validateRequest(limitSchema),
  asyncHandler(async (req, res) => {
    const stats = await draftingService.runDrafting(req.body.limit);
    sendSuccess(res, { message: 'Drafting complete', data: stats });
  }),
);
