import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { sendSuccess } from '../../shared/api-response.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { validateRequest } from '../../shared/validate-request.js';
import { enrichmentService } from './enrichment.service.js';

const runSchema = z.object({
  body: z.object({ limit: z.coerce.number().int().positive().max(50).optional() }),
});

export const enrichmentRouter = Router();

enrichmentRouter.use(authenticate);

enrichmentRouter.post(
  '/run',
  validateRequest(runSchema),
  asyncHandler(async (req, res) => {
    const stats = await enrichmentService.runEnrichment(req.body.limit);
    sendSuccess(res, { message: 'Enrichment complete', data: stats });
  }),
);
