import type { RequestHandler } from 'express';
import { ApiError } from '../../shared/api-error.js';
import { sendSuccess } from '../../shared/api-response.js';
import { campaignService } from './campaign.service.js';

const requireUserId = (req: Parameters<RequestHandler>[0]) => {
  if (!req.user) {
    throw new ApiError(401, 'Authentication required', 'AUTH_REQUIRED');
  }

  return req.user.id;
};

export const campaignController = {
  list: (async (req, res) => {
    const result = await campaignService.list(requireUserId(req), req.query);
    sendSuccess(res, { data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  get: (async (req, res) => {
    const campaign = await campaignService.getById(req.params.id, requireUserId(req));
    sendSuccess(res, { data: campaign });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const campaign = await campaignService.create(requireUserId(req), req.body);
    sendSuccess(res, { statusCode: 201, message: 'Campaign created', data: campaign });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const campaign = await campaignService.update(req.params.id, requireUserId(req), req.body);
    sendSuccess(res, { message: 'Campaign updated', data: campaign });
  }) satisfies RequestHandler,

  remove: (async (req, res) => {
    const campaign = await campaignService.remove(req.params.id, requireUserId(req));
    sendSuccess(res, { message: 'Campaign archived', data: campaign });
  }) satisfies RequestHandler,
};
