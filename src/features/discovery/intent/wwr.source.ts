import { env } from '../../../config/env.js';
import { fetchText } from '../../../shared/http-fetch.js';
import { logger } from '../../../shared/logger.js';
import { createSpacedRunner } from '../../../shared/rate-limiter.js';
import { decodeEntities, stripHtml, truncate } from '../../../shared/text.js';
import type { CampaignDocument } from '../../campaigns/campaign.model.js';
import { loadFixtureText } from '../fixtures.js';
import type { DiscoverySource, LeadCandidate } from '../source.types.js';

const FEEDS = [
  'https://weworkremotely.com/categories/remote-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-design-jobs.rss',
];

const runSpaced = createSpacedRunner(2000);

export type RssItem = {
  title: string;
  link: string;
  description: string;
  pubDate?: string;
  region?: string;
};

const tagValue = (block: string, tag: string): string | undefined => {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));

  if (!match) {
    return undefined;
  }

  const cdata = match[1].match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return decodeEntities((cdata ? cdata[1] : match[1]).trim());
};

/** Minimal RSS reader — the feeds are simple and this avoids an XML dependency. */
export const parseRssItems = (xml: string): RssItem[] => {
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];

  return blocks
    .map((block) => ({
      title: tagValue(block, 'title') ?? '',
      link: tagValue(block, 'link') ?? '',
      description: tagValue(block, 'description') ?? '',
      pubDate: tagValue(block, 'pubDate'),
      region: tagValue(block, 'region'),
    }))
    .filter((item) => item.title && item.link);
};

/** WeWorkRemotely titles are formatted "Company: Position". */
export const splitCompanyAndRole = (title: string): { company: string; role: string } => {
  const index = title.indexOf(':');

  if (index === -1) {
    return { company: title.trim(), role: title.trim() };
  }

  return {
    company: title.slice(0, index).trim(),
    role: title.slice(index + 1).trim(),
  };
};

/**
 * WeWorkRemotely descriptions carry the company's own site as a literal
 * "URL: https://…" line. Without it there is nothing for enrichment to scrape,
 * so every lead stalls at "apply manually".
 */
export const extractWebsiteUrl = (description: string): string | undefined => {
  const text = stripHtml(description);
  const labelled = text.match(/\bURL:\s*(https?:\/\/[^\s<"']+)/i);
  const candidate = labelled?.[1] ?? text.match(/https?:\/\/[^\s<"']+/)?.[0];

  if (!candidate) {
    return undefined;
  }

  // Never point enrichment back at the job board itself.
  const cleaned = candidate.replace(/[.,)\]]+$/, '');
  return /weworkremotely\.com/i.test(cleaned) ? undefined : cleaned;
};

const toCandidate = (item: RssItem): LeadCandidate | undefined => {
  const { company, role } = splitCompanyAndRole(item.title);

  if (!company || !item.link) {
    return undefined;
  }

  const idMatch = item.link.match(/\/remote-jobs\/([^/?#]+)/);

  return {
    source: 'wwr',
    sourceKind: 'intent',
    externalId: idMatch ? idMatch[1] : item.link,
    sourceUrl: item.link,
    postedAt: item.pubDate ? new Date(item.pubDate) : undefined,
    name: company,
    company,
    location: item.region,
    websiteUrl: extractWebsiteUrl(item.description),
    intent: {
      title: truncate(role, 300),
      excerpt: truncate(stripHtml(item.description), 3500),
      tags: ['weworkremotely'],
    },
  };
};

export const wwrSource: DiscoverySource = {
  name: 'wwr',
  kind: 'intent',

  async fetchCandidates(_campaign: CampaignDocument, limit: number) {
    const items: RssItem[] = [];

    if (env.DISCOVERY_DRY_RUN) {
      items.push(...parseRssItems(await loadFixtureText('wwr.rss')));
    } else {
      for (const feed of FEEDS) {
        try {
          const response = await runSpaced(() =>
            fetchText(feed, {
              timeoutMs: 20_000,
              maxBytes: 3_000_000,
              accept: 'application/rss+xml, application/xml, text/xml',
            }),
          );

          if (response.ok) {
            items.push(...parseRssItems(response.body));
          }
        } catch (error) {
          logger.warn({ error, feed }, 'WeWorkRemotely feed fetch failed');
        }
      }
    }

    return items
      .map(toCandidate)
      .filter((candidate): candidate is LeadCandidate => Boolean(candidate))
      .slice(0, limit * 2);
  },
};
