import { env } from '../../../config/env.js';
import { fetchText } from '../../../shared/http-fetch.js';
import { logger } from '../../../shared/logger.js';
import { createSpacedRunner } from '../../../shared/rate-limiter.js';
import { sleep } from '../../../shared/sleep.js';
import type { CampaignDocument } from '../../campaigns/campaign.model.js';
import { loadFixture } from '../fixtures.js';
import type { DiscoverySource, LeadCandidate } from '../source.types.js';
import { rotateAreas } from './area-rotation.js';
import { buildOverpassQuery } from './overpass.query.js';
import { parseOverpassResponse, type OverpassResponse } from './overpass.parse.js';

// Overpass is a donated public service. One request at a time, widely spaced.
const runSpaced = createSpacedRunner(env.OVERPASS_MIN_INTERVAL_MS);

const MAX_ATTEMPTS = 3;

const requestOverpass = async (query: string): Promise<OverpassResponse | undefined> => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await runSpaced(() =>
      fetchText(env.OVERPASS_ENDPOINT, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs: env.OVERPASS_TIMEOUT_MS,
        maxBytes: 10_000_000,
        accept: 'application/json',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );

    if (response.ok) {
      try {
        return JSON.parse(response.body) as OverpassResponse;
      } catch (error) {
        logger.warn({ error }, 'Overpass returned malformed JSON');
        return undefined;
      }
    }

    // 429 = rate limited, 504 = the shared scheduler shed our load. Both mean back off.
    if (response.status === 429 || response.status === 504) {
      const waitMs = response.retryAfterMs ?? attempt * env.OVERPASS_MIN_INTERVAL_MS * 2;
      logger.warn({ status: response.status, waitMs, attempt }, 'Overpass throttled, backing off');
      await sleep(waitMs);
      continue;
    }

    logger.warn({ status: response.status }, 'Overpass request failed');
    return undefined;
  }

  return undefined;
};

export const osmSource: DiscoverySource = {
  name: 'osm',
  kind: 'fit',

  async fetchCandidates(campaign: CampaignDocument, limit: number) {
    if (env.DISCOVERY_DRY_RUN) {
      const fixture = await loadFixture<OverpassResponse>('overpass.json');
      return parseOverpassResponse(fixture).slice(0, limit);
    }

    const { areas, categories } = campaign.osmTargeting;

    if (areas.length === 0 || categories.length === 0) {
      logger.info({ campaignId: campaign.id }, 'OSM targeting incomplete, skipping');
      return [];
    }

    // One request per area. Bundling every area into a single query makes it
    // heavy enough that Overpass answers 504, and one slow area then takes the
    // whole run down with it.
    const candidates: LeadCandidate[] = [];

    // Rotate the starting area daily. Without this the loop always drains the
    // first city and the rest of the list is never reached.
    for (const area of rotateAreas(areas)) {
      if (candidates.length >= limit) {
        break;
      }

      let query: string;

      try {
        query = buildOverpassQuery({
          areas: [area],
          categories,
          countryCode: campaign.osmTargeting.countryCode,
          maxResults: Math.min(env.OVERPASS_MAX_RESULTS, Math.max(limit * 2, 50)),
          timeoutSeconds: Math.floor(env.OVERPASS_TIMEOUT_MS / 1000),
        });
      } catch (error) {
        logger.warn({ error, area }, 'Could not build Overpass query');
        continue;
      }

      const response = await requestOverpass(query);

      if (response) {
        candidates.push(...parseOverpassResponse(response, campaign.osmTargeting.countryCode));
      } else {
        logger.warn({ area }, 'Overpass returned nothing for area');
      }
    }

    return candidates.slice(0, limit);
  },
};
