import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { sendSuccess } from '../../shared/api-response.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { validateRequest } from '../../shared/validate-request.js';
import { suppressionReasons, suppressionTypes } from './suppression.model.js';
import { suppressionService } from './suppression.service.js';

const listSchema = z.object({
  query: z.object({
    search: z.string().max(120).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().optional(),
  }),
});

const addSchema = z.object({
  body: z.object({
    type: z.enum(suppressionTypes).default('email'),
    value: z.string().min(3).max(254),
    reason: z.enum(suppressionReasons).default('manual'),
    note: z.string().max(500).optional(),
  }),
});

const idSchema = z.object({
  params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') }),
});

export const complianceRouter = Router();

complianceRouter.use(authenticate);

complianceRouter.get(
  '/suppressions',
  validateRequest(listSchema),
  asyncHandler(async (req, res) => {
    const result = await suppressionService.list(req.query);
    sendSuccess(res, { data: result.items, meta: result.meta });
  }),
);

complianceRouter.post(
  '/suppressions',
  validateRequest(addSchema),
  asyncHandler(async (req, res) => {
    const suppression = await suppressionService.add(req.body);
    sendSuccess(res, { statusCode: 201, message: 'Suppression added', data: suppression });
  }),
);

complianceRouter.delete(
  '/suppressions/:id',
  validateRequest(idSchema),
  asyncHandler(async (req, res) => {
    await suppressionService.remove(req.params.id);
    sendSuccess(res, { message: 'Suppression removed', data: null });
  }),
);
