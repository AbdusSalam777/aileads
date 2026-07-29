import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { validateRequest } from '../../shared/validate-request.js';
import { leadController } from './lead.controller.js';
import {
  addLeadNoteSchema,
  leadIdSchema,
  leadStatsSchema,
  listLeadsSchema,
  updateLeadStatusSchema,
} from './lead.schemas.js';

export const leadRouter = Router();

leadRouter.use(authenticate);

leadRouter.get('/', validateRequest(listLeadsSchema), asyncHandler(leadController.list));
leadRouter.get('/stats', validateRequest(leadStatsSchema), asyncHandler(leadController.stats));
leadRouter.get('/:id', validateRequest(leadIdSchema), asyncHandler(leadController.get));
leadRouter.patch(
  '/:id/status',
  validateRequest(updateLeadStatusSchema),
  asyncHandler(leadController.updateStatus),
);
leadRouter.post(
  '/:id/notes',
  validateRequest(addLeadNoteSchema),
  asyncHandler(leadController.addNote),
);
