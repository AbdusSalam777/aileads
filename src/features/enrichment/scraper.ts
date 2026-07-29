import robotsParserImport from 'robots-parser';
import { env, userAgent } from '../../config/env.js';
import { fetchText, HttpFetchError } from '../../shared/http-fetch.js';
import { logger } from '../../shared/logger.js';
import { createSpacedRunner } from '../../shared/rate-limiter.js';
import { loadFixtureText } from '../discovery/fixtures.js';
import { pickBestEmail } from './email-extract.js';
import { extractSiteContext, type ExtractedSite } from './site-context.js';

type RobotsRules = { isAllowed(url: string, ua?: string): boolean | undefined };

// robots-parser ships a shorthand ambient declaration that TS resolves to a
// namespace, but the runtime export is the function itself.
const robotsParser = robotsParserImport as unknown as (url: string, txt: string) => RobotsRules;

const runSpaced = createSpacedRunner(env.SCRAPE_MIN_INTERVAL_MS);

const CONTACT_PATHS = ['/contact', '/contact-us', '/about', '/about-us'];

export type ScrapeResult = {
  ok: boolean;
  finalUrl?: string;
  statusCode?: number;
  site?: ExtractedSite;
  email?: string;
  emailConfidence?: number;
  emailsFound: string[];
  error?: string;
};

const fetchRobots = async (origin: string) => {
  try {
    const response = await runSpaced(() =>
      fetchText(`${origin}/robots.txt`, {
        timeoutMs: Math.min(env.SCRAPE_TIMEOUT_MS, 8000),
        maxBytes: 100_000,
        accept: 'text/plain',
      }),
    );

    return response.ok ? response.body : undefined;
  } catch {
    // No robots.txt (or it timed out) means no stated restriction.
    return undefined;
  }
};

const fetchPage = async (url: string) =>
  runSpaced(() =>
    fetchText(url, { timeoutMs: env.SCRAPE_TIMEOUT_MS, maxBytes: env.SCRAPE_MAX_BYTES }),
  );

/**
 * Fetches a business's own public website to find a contact address and the
 * evidence used to personalise outreach. robots.txt is honoured absolutely.
 */
export const scrapeSite = async (websiteUrl: string): Promise<ScrapeResult> => {
  if (env.DISCOVERY_DRY_RUN) {
    const html = await loadFixtureText('sample-site.html');
    const site = extractSiteContext(html, websiteUrl);
    const picked = pickBestEmail(html, websiteUrl);

    return {
      ok: true,
      finalUrl: websiteUrl,
      statusCode: 200,
      site,
      email: picked?.email,
      emailConfidence: picked?.confidence,
      emailsFound: picked ? [picked.email] : [],
    };
  }

  let origin: string;
  let startUrl: string;

  try {
    const parsed = new URL(websiteUrl);
    origin = parsed.origin;
    startUrl = parsed.toString();
  } catch {
    return { ok: false, emailsFound: [], error: 'Invalid website URL' };
  }

  const robotsTxt = await fetchRobots(origin);
  const robots = robotsTxt ? robotsParser(`${origin}/robots.txt`, robotsTxt) : undefined;

  const isAllowed = (url: string) => !robots || robots.isAllowed(url, userAgent) !== false;

  if (!isAllowed(startUrl)) {
    return { ok: false, emailsFound: [], error: 'Disallowed by robots.txt' };
  }

  const visited: string[] = [];
  const allEmails = new Map<string, number>();
  let site: ExtractedSite | undefined;
  let finalUrl: string | undefined;
  let statusCode: number | undefined;

  const queue: string[] = [startUrl];

  while (queue.length > 0 && visited.length < env.SCRAPE_MAX_PAGES_PER_SITE) {
    const url = queue.shift()!;

    if (visited.includes(url) || !isAllowed(url)) {
      continue;
    }

    visited.push(url);

    let response;

    try {
      response = await fetchPage(url);
    } catch (error) {
      if (visited.length === 1) {
        const message = error instanceof HttpFetchError ? error.message : 'Fetch failed';
        return { ok: false, emailsFound: [], error: message };
      }

      continue;
    }

    statusCode ??= response.status;
    finalUrl ??= response.url;

    if (!response.ok || !response.contentType.includes('html')) {
      if (visited.length === 1) {
        return {
          ok: false,
          statusCode: response.status,
          finalUrl: response.url,
          emailsFound: [],
          error: `HTTP ${response.status}`,
        };
      }

      continue;
    }

    const extracted = extractSiteContext(response.body, response.url);
    site ??= extracted;

    const picked = pickBestEmail(response.body, response.url);

    if (picked && !allEmails.has(picked.email)) {
      allEmails.set(picked.email, picked.confidence);
    }

    // Only wander to contact/about pages, and only if we still need an address.
    if (allEmails.size === 0 && queue.length === 0) {
      for (const path of [...extracted.internalLinks, ...CONTACT_PATHS]) {
        try {
          const next = new URL(path, response.url).toString();

          if (next.startsWith(origin) && !visited.includes(next) && !queue.includes(next)) {
            queue.push(next);
          }
        } catch {
          continue;
        }
      }
    }
  }

  const ranked = [...allEmails.entries()].sort((a, b) => b[1] - a[1]);
  const best = ranked[0];

  if (!site) {
    return { ok: false, statusCode, finalUrl, emailsFound: [], error: 'No readable page found' };
  }

  logger.debug({ websiteUrl, pages: visited.length, emails: ranked.length }, 'Site scraped');

  return {
    ok: true,
    finalUrl,
    statusCode,
    site,
    email: best?.[0],
    emailConfidence: best?.[1],
    emailsFound: ranked.map(([email]) => email),
  };
};
