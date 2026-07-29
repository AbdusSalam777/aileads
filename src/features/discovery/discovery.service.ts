import type { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';
import { truncate } from '../../shared/text.js';
import { CampaignModel, type CampaignDocument } from '../campaigns/campaign.model.js';
import { LeadModel, type LeadSource } from '../leads/lead.model.js';
import { hnSource } from './intent/hn.source.js';
import { scoreIntent } from './intent/intent-score.js';
import { redditSource } from './intent/reddit.source.js';
import { remoteOkSource } from './intent/remoteok.source.js';
import { wwrSource } from './intent/wwr.source.js';
import { osmSource } from './osm/osm.source.js';
import type { DiscoverySource, LeadCandidate } from './source.types.js';

const intentSources: Record<string, DiscoverySource> = {
  hn: hnSource,
  remoteok: remoteOkSource,
  wwr: wwrSource,
  reddit: redditSource,
};

export type DiscoveryStats = {
  campaigns: number;
  intentFetched: number;
  intentKept: number;
  osmFetched: number;
  inserted: number;
  duplicates: number;
  rejected: number;
};

const emptyStats = (): DiscoveryStats => ({
  campaigns: 0,
  intentFetched: 0,
  intentKept: 0,
  osmFetched: 0,
  inserted: 0,
  duplicates: 0,
  rejected: 0,
});

const insertCandidate = async (
  campaignId: Types.ObjectId,
  candidate: LeadCandidate,
  signalScore: number,
  signals: string[],
  stats: DiscoveryStats,
) => {
  // The unique {campaignId, source, externalId} index makes this idempotent, so
  // a repeat discovery run updates nothing and quietly reports a duplicate.
  const existing = await LeadModel.findOne({
    campaignId,
    source: candidate.source,
    externalId: candidate.externalId,
  })
    .select('_id')
    .lean();

  if (existing) {
    stats.duplicates += 1;
    return;
  }

  const hasEmail = Boolean(candidate.contactEmail);

  await LeadModel.create({
    campaignId,
    source: candidate.source,
    sourceKind: candidate.sourceKind,
    externalId: candidate.externalId,
    sourceUrl: candidate.sourceUrl,
    postedAt: candidate.postedAt,
    name: truncate(candidate.name, 300),
    company: candidate.company,
    websiteUrl: candidate.websiteUrl,
    location: candidate.location,
    category: candidate.category,
    intent: candidate.intent
      ? { ...candidate.intent, signalScore, signals }
      : undefined,
    osmTags: candidate.osmTags,
    contactChannel: hasEmail ? 'email' : 'unknown',
    contactEmail: candidate.contactEmail,
    contactEmailConfidence: hasEmail ? 0.8 : 0,
    status: 'discovered',
    statusHistory: [{ from: 'discovered', to: 'discovered', reason: 'discovered', at: new Date() }],
  });

  stats.inserted += 1;
};

const runIntentDiscovery = async (
  campaign: CampaignDocument,
  budget: number,
  stats: DiscoveryStats,
) => {
  if (!campaign.intentEnabled || budget <= 0) {
    return 0;
  }

  const enabled = campaign.intentSources.filter((name) => env.INTENT_SOURCES.includes(name));
  let used = 0;

  for (const sourceName of enabled) {
    const source = intentSources[sourceName];

    if (!source || used >= budget) {
      continue;
    }

    let candidates: LeadCandidate[] = [];

    try {
      candidates = await source.fetchCandidates(campaign, budget - used);
    } catch (error) {
      logger.warn({ error, source: sourceName }, 'Intent source failed');
      continue;
    }

    stats.intentFetched += candidates.length;

    // Score first, then take the best — a source returning 100 posts should not
    // spend the whole daily budget on its worst ones.
    const scored = candidates
      .map((candidate) => ({
        candidate,
        result: scoreIntent({
          title: candidate.intent?.title ?? candidate.name,
          excerpt: candidate.intent?.excerpt ?? '',
          tags: candidate.intent?.tags,
          budgetText: candidate.intent?.budgetText,
          postedAt: candidate.postedAt,
          keywords: [...campaign.services, ...campaign.intentKeywords],
        }),
      }))
      .filter((entry) => {
        if (entry.result.disqualified) {
          stats.rejected += 1;
          return false;
        }

        if (entry.candidate.postedAt) {
          const ageHours = (Date.now() - entry.candidate.postedAt.getTime()) / 3_600_000;

          if (ageHours > env.INTENT_MAX_AGE_HOURS) {
            stats.rejected += 1;
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => b.result.score - a.result.score);

    for (const entry of scored) {
      if (used >= budget) {
        break;
      }

      await insertCandidate(
        campaign._id,
        entry.candidate,
        entry.result.score,
        entry.result.signals,
        stats,
      );
      stats.intentKept += 1;
      used += 1;
    }
  }

  return used;
};

const runOsmBackfill = async (
  campaign: CampaignDocument,
  budget: number,
  stats: DiscoveryStats,
) => {
  if (!campaign.osmEnabled || budget <= 0) {
    return;
  }

  let candidates: LeadCandidate[] = [];

  try {
    candidates = await osmSource.fetchCandidates(campaign, budget);
  } catch (error) {
    logger.warn({ error }, 'OSM discovery failed');
    return;
  }

  stats.osmFetched += candidates.length;

  let used = 0;

  for (const candidate of candidates) {
    if (used >= budget) {
      break;
    }

    await insertCandidate(campaign._id, candidate, 0, [], stats);
    used += 1;
  }
};

export const discoveryService = {
  /**
   * Intent leads (people actively asking for this work) always get first claim
   * on the daily budget; OSM fit-based leads only fill what is left over.
   */
  async runDiscovery(campaignId?: string): Promise<DiscoveryStats> {
    const stats = emptyStats();

    const campaigns = campaignId
      ? await CampaignModel.find({ _id: campaignId })
      : await CampaignModel.find({ status: 'active' });

    for (const campaign of campaigns) {
      stats.campaigns += 1;

      const budget = Math.min(campaign.dailyLeadTarget, env.DISCOVERY_DAILY_LEAD_TARGET);
      const usedByIntent = await runIntentDiscovery(campaign, budget, stats);
      await runOsmBackfill(campaign, budget - usedByIntent, stats);
    }

    logger.info({ stats }, 'Discovery run complete');
    return stats;
  },

  listSourceNames(): LeadSource[] {
    return ['hn', 'remoteok', 'wwr', 'reddit', 'osm'];
  },
};
