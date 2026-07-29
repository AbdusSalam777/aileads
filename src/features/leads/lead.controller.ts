import type { RequestHandler } from 'express';
import { ApiError } from '../../shared/api-error.js';
import { sendSuccess } from '../../shared/api-response.js';
import { leadService } from './lead.service.js';

const requireUserId = (req: Parameters<RequestHandler>[0]) => {
  if (!req.user) {
    throw new ApiError(401, 'Authentication required', 'AUTH_REQUIRED');
  }

  return req.user.id;
};

export const leadController = {
  list: (async (req, res) => {
    const result = await leadService.list(requireUserId(req), req.query);
    sendSuccess(res, { data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  get: (async (req, res) => {
    const result = await leadService.getWithMessages(req.params.id, requireUserId(req));
    sendSuccess(res, { data: result });
  }) satisfies RequestHandler,

  updateStatus: (async (req, res) => {
    const lead = await leadService.updateStatus(
      req.params.id,
      requireUserId(req),
      req.body.status,
      req.body.reason,
    );
    sendSuccess(res, { message: 'Lead status updated', data: lead });
  }) satisfies RequestHandler,

  addNote: (async (req, res) => {
    const lead = await leadService.addNote(req.params.id, requireUserId(req), req.body.body);
    sendSuccess(res, { message: 'Note added', data: lead });
  }) satisfies RequestHandler,

  stats: (async (req, res) => {
    const stats = await leadService.statsByStatus(
      requireUserId(req),
      req.query.campaignId as string | undefined,
    );
    sendSuccess(res, { data: stats });
  }) satisfies RequestHandler,
};
