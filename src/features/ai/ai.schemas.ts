import { z } from 'zod';
import { leadTiers } from '../leads/lead.model.js';

/**
 * Length limits are enforced by truncating rather than rejecting. A model that
 * returns a slightly verbose label is still giving a usable answer, and
 * discarding the whole qualification over it loses a real lead.
 */
const cappedText = (max: number) =>
  z
    .string()
    .min(1)
    .transform((value) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value));

export const qualificationOutputSchema = z.object({
  score: z.coerce.number().min(0).max(100),
  tier: z.enum(leadTiers),
  reasons: z.array(cappedText(300)).min(1).max(6),
  personalizationHooks: z.array(cappedText(300)).max(5).default([]),
  serviceFit: z.array(cappedText(60)).max(6).default([]),
  recommendation: z.enum(['contact', 'skip']),
});

export type QualificationOutput = z.infer<typeof qualificationOutputSchema>;

export const draftOutputSchema = z.object({
  subject: z.string().min(3).max(120),
  body: z.string().min(40).max(2500),
  hookUsed: z.string().max(300).default(''),
});

export type DraftOutput = z.infer<typeof draftOutputSchema>;
