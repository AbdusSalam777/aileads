import { env } from '../../../config/env.js';
import { fetchJson } from '../../../shared/http-fetch.js';
import { logger } from '../../../shared/logger.js';
import { stripHtml, truncate } from '../../../shared/text.js';
import type { CampaignDocument } from '../../campaigns/campaign.model.js';
import { pickBestEmail } from '../../enrichment/email-extract.js';
import { loadFixture } from '../fixtures.js';
import type { DiscoverySource, LeadCandidate } from '../source.types.js';

const REMOTEOK_API = 'https://remoteok.com/api';

type RemoteOkEntry = {
  id?: string | number;
  slug?: string;
  company?: string;
  position?: string;
  description?: string;
  tags?: string[];
  date?: string;
  url?: string;
  apply_url?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  /** The first element of the response is a legal/attribution notice, not a job. */
  legal?: string;
};

const toCandidate = (entry: RemoteOkEntry): LeadCandidate | undefined => {
  if (entry.legal || !entry.id || !entry.company || !entry.position) {
    return undefined;
  }

  const description = stripHtml(entry.description ?? '');
  const budgetText =
    entry.salary_min && entry.salary_max
      ? `$${entry.salary_min} - $${entry.salary_max}`
      : entry.salary_min
        ? `$${entry.salary_min}+`
        : undefined;

  const picked = pickBestEmail(description);

  return {
    source: 'remoteok',
    sourceKind: 'intent',
    externalId: String(entry.id),
    sourceUrl: entry.url ?? entry.apply_url,
    postedAt: entry.date ? new Date(entry.date) : undefined,
    name: entry.company,
    company: entry.company,
    location: entry.location,
    intent: {
      title: truncate(entry.position, 300),
      excerpt: truncate(description, 3500),
      budgetText,
      tags: ['remoteok', ...(entry.tags ?? []).slice(0, 10)],
    },
    contactEmail: picked?.email,
  };
};

export const remoteOkSource: DiscoverySource = {
  name: 'remoteok',
  kind: 'intent',

  async fetchCandidates(_campaign: CampaignDocument, limit: number) {
    let entries: RemoteOkEntry[];

    if (env.DISCOVERY_DRY_RUN) {
      entries = await loadFixture<RemoteOkEntry[]>('remoteok.json');
    } else {
      try {
        entries = await fetchJson<RemoteOkEntry[]>(REMOTEOK_API, {
          timeoutMs: 20_000,
          maxBytes: 5_000_000,
        });
      } catch (error) {
        logger.warn({ error }, 'RemoteOK fetch failed');
        return [];
      }
    }

    return entries
      .map(toCandidate)
      .filter((candidate): candidate is LeadCandidate => Boolean(candidate))
      .slice(0, limit * 2);
  },
};
