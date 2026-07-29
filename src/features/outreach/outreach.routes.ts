import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { ApiError } from '../../shared/api-error.js';
import { sendSuccess } from '../../shared/api-response.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { validateRequest } from '../../shared/validate-request.js';
import { messageStatuses } from './outreach-message.model.js';
import { outreachService } from './outreach.service.js';
import { senderService } from './sender.service.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const listSchema = z.object({
  query: z.object({
    status: z.enum(messageStatuses).optional(),
    campaignId: objectId.optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().optional(),
  }),
});

const idSchema = z.object({ params: z.object({ id: objectId }) });

const updateSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    subject: z.string().min(3).max(200).optional(),
    body: z.string().min(20).max(5000).optional(),
  }),
});

const discardSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ reason: z.string().max(500).optional() }),
});

export const outreachRouter = Router();

outreachRouter.use(authenticate);

const requireUserId = (req: { user?: { id: string } }) => {
  if (!req.user) {
    throw new ApiError(401, 'Authentication required', 'AUTH_REQUIRED');
  }

  return req.user.id;
};

outreachRouter.get(
  '/queue-status',
  asyncHandler(async (req, res) => {
    sendSuccess(res, { data: await outreachService.queueStatus(requireUserId(req)) });
  }),
);

outreachRouter.get(
  '/',
  validateRequest(listSchema),
  asyncHandler(async (req, res) => {
    const result = await outreachService.list(requireUserId(req), req.query);
    sendSuccess(res, { data: result.items, meta: result.meta });
  }),
);

outreachRouter.get(
  '/:id',
  validateRequest(idSchema),
  asyncHandler(async (req, res) => {
    sendSuccess(res, { data: await outreachService.getById(req.params.id, requireUserId(req)) });
  }),
);

outreachRouter.patch(
  '/:id',
  validateRequest(updateSchema),
  asyncHandler(async (req, res) => {
    const message = await outreachService.update(req.params.id, requireUserId(req), req.body);
    sendSuccess(res, { message: 'Draft updated', data: message });
  }),
);

outreachRouter.post(
  '/:id/approve',
  validateRequest(idSchema),
  asyncHandler(async (req, res) => {
    const message = await outreachService.approve(req.params.id, requireUserId(req));
    sendSuccess(res, { message: 'Approved and queued', data: message });
  }),
);

outreachRouter.post(
  '/:id/discard',
  validateRequest(discardSchema),
  asyncHandler(async (req, res) => {
    const message = await outreachService.discard(
      req.params.id,
      requireUserId(req),
      req.body.reason,
    );
    sendSuccess(res, { message: 'Draft discarded', data: message });
  }),
);

outreachRouter.post(
  '/send-cycle',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { message: 'Send cycle complete', data: await senderService.runSendCycle() });
  }),
);
