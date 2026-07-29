import { env } from '../../../config/env.js';
import { fetchJson } from '../../../shared/http-fetch.js';
import { logger } from '../../../shared/logger.js';
import { createSpacedRunner } from '../../../shared/rate-limiter.js';
import { stripHtml, truncate } from '../../../shared/text.js';
import type { CampaignDocument } from '../../campaigns/campaign.model.js';
import { pickBestEmail } from '../../enrichment/email-extract.js';
import { loadFixture } from '../fixtures.js';
import type { DiscoverySource, LeadCandidate } from '../source.types.js';

const ALGOLIA_BASE = 'https://hn.algolia.com/api/v1';

type AlgoliaHit = {
  objectID: string;
  created_at?: string;
  author?: string;
  comment_text?: string | null;
  story_title?: string | null;
  story_url?: string | null;
  title?: string | null;
  url?: string | null;
};

type AlgoliaResponse = { hits: AlgoliaHit[] };

// HN Algolia is a free public API but still a shared service — keep it polite.
const runSpaced = createSpacedRunner(1200);

const firstUrl = (text: string): string | undefined => {
  const match = text.match(/https?:\/\/[^\s<>"')]+/i);
  return match ? match[0].replace(/[.,;:]+$/, '') : undefined;
};

/**
 * The monthly "Ask HN: Freelancer? Seeking freelancer?" thread is the only part
 * of HN that reliably contains people wanting to pay for project work. Posts
 * there open with SEEKING FREELANCER (a client) or SEEKING WORK (a competitor).
 */
export const isFreelancerRequest = (text: string): boolean => {
  const normalised = text.toLowerCase();

  if (normalised.startsWith('[dead]') || normalised.startsWith('[flagged]')) {
    return false;
  }

  // SEEKING WORK posts are other freelancers advertising themselves.
  return normalised.includes('seeking freelancer') && !normalised.includes('seeking work');
};

const toCandidate = (hit: AlgoliaHit): LeadCandidate | undefined => {
  const rawText = hit.comment_text ?? hit.title ?? '';

  if (!rawText) {
    return undefined;
  }

  const text = stripHtml(rawText);

  if (text.length < 40 || !isFreelancerRequest(text)) {
    return undefined;
  }

  const picked = pickBestEmail(text);
  const website = firstUrl(text) ?? hit.story_url ?? hit.url ?? undefined;

  return {
    source: 'hn',
    sourceKind: 'intent',
    externalId: hit.objectID,
    sourceUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    postedAt: hit.created_at ? new Date(hit.created_at) : undefined,
    name: hit.author ?? 'Hacker News poster',
    websiteUrl: website,
    intent: {
      title: truncate(hit.story_title ?? hit.title ?? 'Hacker News post', 300),
      excerpt: truncate(text, 3500),
      tags: ['hackernews'],
    },
    contactEmail: picked?.email,
  };
};

const search = async (query: string, hitsPerPage: number): Promise<AlgoliaHit[]> => {
  const url = `${ALGOLIA_BASE}/search_by_date?tags=comment&query=${encodeURIComponent(query)}&hitsPerPage=${hitsPerPage}`;

  try {
    const response = await runSpaced(() =>
      fetchJson<AlgoliaResponse>(url, { timeoutMs: 20_000, maxBytes: 2_000_000 }),
    );
    return response.hits ?? [];
  } catch (error) {
    logger.warn({ error, query }, 'Hacker News search failed');
    return [];
  }
};

export const hnSource: DiscoverySource = {
  name: 'hn',
  kind: 'intent',

  async fetchCandidates(_campaign: CampaignDocument, limit: number) {
    if (env.DISCOVERY_DRY_RUN) {
      const fixture = await loadFixture<AlgoliaResponse>('hn-search.json');
      return fixture.hits.map(toCandidate).filter((c): c is LeadCandidate => Boolean(c)).slice(0, limit);
    }

    // Only the freelancer-thread convention is searched. Campaign keywords are
    // deliberately NOT queried on their own: doing so returns every HN comment
    // that happens to mention "shopify" or "landing page" — news, Show HN posts
    // and idle chatter — none of which is anyone wanting to hire.
    const perQuery = Math.max(50, limit * 4);
    const seen = new Set<string>();
    const candidates: LeadCandidate[] = [];

    for (const query of ['SEEKING FREELANCER']) {
      for (const hit of await search(query, perQuery)) {
        if (seen.has(hit.objectID)) {
          continue;
        }

        seen.add(hit.objectID);
        const candidate = toCandidate(hit);

        if (candidate) {
          candidates.push(candidate);
        }
      }

      if (candidates.length >= limit * 2) {
        break;
      }
    }

    return candidates;
  },
};
