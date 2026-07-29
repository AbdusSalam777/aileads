import { isJunkEmail } from '../../enrichment/email-extract.js';
import type { LeadCandidate } from '../source.types.js';

export type OverpassElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export type OverpassResponse = {
  elements?: OverpassElement[];
};

const CATEGORY_KEYS = ['shop', 'amenity', 'office', 'craft', 'tourism', 'leisure'];

const normalizeUrl = (value: string): string | undefined => {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(withScheme).toString();
  } catch {
    return undefined;
  }
};

const buildLocation = (tags: Record<string, string>): string | undefined => {
  const parts = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:city'] ?? tags['addr:town'],
    tags['addr:postcode'],
    tags['addr:country'],
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(', ') : undefined;
};

export const parseOverpassResponse = (response: OverpassResponse): LeadCandidate[] => {
  const elements = response.elements ?? [];
  const candidates: LeadCandidate[] = [];

  for (const element of elements) {
    const tags = element.tags ?? {};
    const name = tags.name?.trim();

    if (!name || !element.id || !element.type) {
      continue;
    }

    const website = normalizeUrl(tags.website ?? tags['contact:website'] ?? '');
    const rawEmail = (tags.email ?? tags['contact:email'] ?? '').trim().toLowerCase();
    const email = rawEmail && !isJunkEmail(rawEmail) ? rawEmail : undefined;

    // Unreachable either way — not worth storing.
    if (!website && !email) {
      continue;
    }

    const categoryKey = CATEGORY_KEYS.find((key) => tags[key]);

    candidates.push({
      source: 'osm',
      sourceKind: 'fit',
      externalId: `${element.type}/${element.id}`,
      sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      name,
      company: name,
      websiteUrl: website,
      location: buildLocation(tags),
      category: categoryKey ? `${categoryKey}=${tags[categoryKey]}` : undefined,
      osmTags: tags,
      contactEmail: email,
    });
  }

  return candidates;
};
