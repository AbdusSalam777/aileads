import type { CampaignDocument } from '../campaigns/campaign.model.js';
import type { LeadSource, LeadSourceKind } from '../leads/lead.model.js';

/** A raw, un-scored candidate returned by a discovery source. */
export type LeadCandidate = {
  source: LeadSource;
  sourceKind: LeadSourceKind;
  /** Stable per-source identity — makes repeat discovery runs idempotent. */
  externalId: string;
  sourceUrl?: string;
  postedAt?: Date;

  name: string;
  company?: string;
  websiteUrl?: string;
  location?: string;
  category?: string;

  /** Present for intent leads: the post that signalled demand. */
  intent?: {
    title: string;
    excerpt: string;
    budgetText?: string;
    tags: string[];
  };

  osmTags?: Record<string, string>;

  /** Some sources embed a contact address directly in the post. */
  contactEmail?: string;
};

export type DiscoverySource = {
  name: LeadSource;
  kind: LeadSourceKind;
  fetchCandidates(campaign: CampaignDocument, limit: number): Promise<LeadCandidate[]>;
};
