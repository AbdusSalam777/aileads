import { env, userAgent } from '../../../config/env.js';
import { fetchJson, fetchText } from '../../../shared/http-fetch.js';
import { logger } from '../../../shared/logger.js';
import { createSpacedRunner } from '../../../shared/rate-limiter.js';
import { truncate } from '../../../shared/text.js';
import type { CampaignDocument } from '../../campaigns/campaign.model.js';
import { pickBestEmail } from '../../enrichment/email-extract.js';
import { loadFixture } from '../fixtures.js';
import type { DiscoverySource, LeadCandidate } from '../source.types.js';

const SUBREDDITS = ['forhire', 'DesignJobs', 'VideoEditingRequests', 'editors'];

const runSpaced = createSpacedRunner(2000);

type RedditListing = {
  data?: {
    children?: Array<{
      data?: {
        id?: string;
        title?: string;
        selftext?: string;
        author?: string;
        permalink?: string;
        created_utc?: number;
        link_flair_text?: string | null;
        subreddit?: string;
      };
    }>;
  };
};

let cachedToken: { value: string; expiresAt: number } | undefined;

const getAccessToken = async (): Promise<string | undefined> => {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) {
    return undefined;
  }

  const basic = Buffer.from(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`).toString(
    'base64',
  );

  try {
    const response = await fetchText('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      timeoutMs: 15_000,
      body: 'grant_type=client_credentials',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent,
      },
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'Reddit token request failed');
      return undefined;
    }

    const parsed = JSON.parse(response.body) as { access_token?: string; expires_in?: number };

    if (!parsed.access_token) {
      return undefined;
    }

    cachedToken = {
      value: parsed.access_token,
      expiresAt: Date.now() + (parsed.expires_in ?? 3600) * 1000,
    };

    return cachedToken.value;
  } catch (error) {
    logger.warn({ error }, 'Reddit authentication failed');
    return undefined;
  }
};

const isHiringPost = (title: string, flair?: string | null): boolean => {
  const haystack = `${title} ${flair ?? ''}`.toLowerCase();
  return haystack.includes('[hiring]') || haystack.includes('hiring');
};

const toCandidate = (
  post: NonNullable<NonNullable<RedditListing['data']>['children']>[number]['data'],
): LeadCandidate | undefined => {
  if (!post?.id || !post.title || !isHiringPost(post.title, post.link_flair_text)) {
    return undefined;
  }

  const body = post.selftext ?? '';
  const picked = pickBestEmail(body);

  return {
    source: 'reddit',
    sourceKind: 'intent',
    externalId: post.id,
    sourceUrl: post.permalink ? `https://www.reddit.com${post.permalink}` : undefined,
    postedAt: post.created_utc ? new Date(post.created_utc * 1000) : undefined,
    name: post.author ?? 'Reddit poster',
    intent: {
      title: truncate(post.title, 300),
      excerpt: truncate(body, 3500),
      tags: ['reddit', post.subreddit ?? 'unknown'].filter(Boolean),
    },
    contactEmail: picked?.email,
  };
};

export const redditSource: DiscoverySource = {
  name: 'reddit',
  kind: 'intent',

  async fetchCandidates(_campaign: CampaignDocument, limit: number) {
    if (env.DISCOVERY_DRY_RUN) {
      const fixture = await loadFixture<RedditListing>('reddit.json');
      return (fixture.data?.children ?? [])
        .map((child) => toCandidate(child.data))
        .filter((candidate): candidate is LeadCandidate => Boolean(candidate))
        .slice(0, limit);
    }

    const token = await getAccessToken();

    if (!token) {
      logger.warn('Reddit source skipped: no credentials or token request failed');
      return [];
    }

    const candidates: LeadCandidate[] = [];

    for (const subreddit of SUBREDDITS) {
      try {
        const listing = await runSpaced(() =>
          fetchJson<RedditListing>(`https://oauth.reddit.com/r/${subreddit}/new?limit=50`, {
            timeoutMs: 20_000,
            maxBytes: 3_000_000,
            headers: { Authorization: `Bearer ${token}`, 'User-Agent': userAgent },
          }),
        );

        for (const child of listing.data?.children ?? []) {
          const candidate = toCandidate(child.data);

          if (candidate) {
            candidates.push(candidate);
          }
        }
      } catch (error) {
        logger.warn({ error, subreddit }, 'Reddit listing fetch failed');
      }

      if (candidates.length >= limit * 2) {
        break;
      }
    }

    return candidates;
  },
};
