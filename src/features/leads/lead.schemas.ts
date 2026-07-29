import { z } from 'zod';
import { contactChannels, leadSources, leadStatuses } from './lead.model.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const listLeadsSchema = z.object({
  query: z.object({
    campaignId: objectId.optional(),
    status: z.enum(leadStatuses).optional(),
    source: z.enum(leadSources).optional(),
    contactChannel: z.enum(contactChannels).optional(),
    search: z.string().max(120).optional(),
    minScore: z.coerce.number().int().min(0).max(100).optional(),
    sort: z.enum(['recent', 'score']).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().optional(),
  }),
});

export const leadIdSchema = z.object({ params: z.object({ id: objectId }) });

export const updateLeadStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    status: z.enum(leadStatuses),
    reason: z.string().max(500).optional(),
  }),
});

export const addLeadNoteSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ body: z.string().min(1).max(2000) }),
});

export const leadStatsSchema = z.object({
  query: z.object({ campaignId: objectId.optional() }),
});

export type ListLeadsQuery = z.infer<typeof listLeadsSchema>['query'];
export type UpdateLeadStatusInput = z.infer<typeof updateLeadStatusSchema>['body'];
