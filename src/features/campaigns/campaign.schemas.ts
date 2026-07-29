import { z } from 'zod';
import { campaignStatuses, intentSourceNames } from './campaign.model.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const senderSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(254).toLowerCase(),
  title: z.string().max(120).optional(),
  company: z.string().max(120).optional(),
  physicalAddress: z.string().max(300).optional(),
  portfolioUrl: z.string().url().max(500).optional().or(z.literal('')),
  calendarUrl: z.string().url().max(500).optional().or(z.literal('')),
});

const sendingSchema = z.object({
  dailyCap: z.number().int().min(1).max(50),
  minSpacingMinutes: z.number().int().min(1),
  maxSpacingMinutes: z.number().int().min(1),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(1).max(24),
  days: z.array(z.number().int().min(0).max(6)).max(7),
  timezone: z.string().min(1).max(64),
});

const followUpSchema = z.object({
  enabled: z.boolean(),
  maxSteps: z.number().int().min(0).max(2),
  delayDays: z.array(z.number().int().min(1).max(60)).max(2),
});

const osmTargetingSchema = z.object({
  areas: z.array(z.string().min(1).max(120)).max(20),
  categories: z.array(z.string().min(1).max(120)).max(30),
});

const campaignBody = z.object({
  name: z.string().min(2).max(120),
  services: z.array(z.string().min(1).max(120)).max(20).default([]),
  offer: z.string().max(2000).default(''),
  icp: z.string().max(2000).default(''),
  sender: senderSchema,
  intentEnabled: z.boolean().default(true),
  intentSources: z.array(z.enum(intentSourceNames)).max(4).default(['hn', 'remoteok', 'wwr']),
  intentKeywords: z.array(z.string().min(1).max(60)).max(40).default([]),
  osmEnabled: z.boolean().default(false),
  osmTargeting: osmTargetingSchema.default({ areas: [], categories: [] }),
  sending: sendingSchema.partial().optional(),
  followUp: followUpSchema.partial().optional(),
  minScoreToDraft: z.number().int().min(0).max(100).default(60),
  dailyLeadTarget: z.number().int().min(1).max(500).default(40),
});

export const createCampaignSchema = z.object({ body: campaignBody });

export const updateCampaignSchema = z.object({
  params: z.object({ id: objectId }),
  body: campaignBody.partial().extend({
    status: z.enum(campaignStatuses).optional(),
  }),
});

export const campaignIdSchema = z.object({ params: z.object({ id: objectId }) });

export const listCampaignsSchema = z.object({
  query: z.object({
    status: z.enum(campaignStatuses).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().optional(),
  }),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>['body'];
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>['body'];
export type ListCampaignsQuery = z.infer<typeof listCampaignsSchema>['query'];
