export type OverpassTargeting = {
  areas: string[];
  categories: string[];
  maxResults: number;
  timeoutSeconds?: number;
};

/** Friendly words the operator is likely to type, mapped to real OSM tags. */
const CATEGORY_ALIASES: Record<string, string> = {
  restaurant: 'amenity=restaurant',
  cafe: 'amenity=cafe',
  bar: 'amenity=bar',
  pub: 'amenity=pub',
  hotel: 'tourism=hotel',
  dentist: 'amenity=dentist',
  doctor: 'amenity=doctors',
  veterinary: 'amenity=veterinary',
  pharmacy: 'amenity=pharmacy',
  gym: 'leisure=fitness_centre',
  hairdresser: 'shop=hairdresser',
  beauty: 'shop=beauty',
  florist: 'shop=florist',
  bakery: 'shop=bakery',
  butcher: 'shop=butcher',
  car_repair: 'shop=car_repair',
  garage: 'shop=car_repair',
  lawyer: 'office=lawyer',
  accountant: 'office=accountant',
  estate_agent: 'office=estate_agent',
  architect: 'office=architect',
  photographer: 'craft=photographer',
  builder: 'craft=builder',
  plumber: 'craft=plumber',
  electrician: 'craft=electrician',
  carpenter: 'craft=carpenter',
};

/**
 * Overpass QL has no parameter binding, so any operator-supplied string is
 * escaped before interpolation. Anything outside this character set is dropped
 * rather than escaped, so a malformed value can never terminate the quoted
 * string and inject new statements.
 */
const sanitizeValue = (value: string): string =>
  value
    .trim()
    .replace(/[^\p{L}\p{N} .,'’&/_-]/gu, '')
    .slice(0, 80);

const sanitizeTagKey = (value: string): string =>
  value.trim().replace(/[^a-zA-Z0-9_:]/g, '').slice(0, 40);

export type ParsedCategory = { key: string; value: string };

export const parseCategory = (input: string): ParsedCategory | undefined => {
  const normalized = input.trim().toLowerCase();
  const aliased = CATEGORY_ALIASES[normalized] ?? input.trim();
  const [rawKey, rawValue] = aliased.split('=');

  if (!rawKey || !rawValue) {
    return undefined;
  }

  const key = sanitizeTagKey(rawKey);
  const value = sanitizeTagKey(rawValue);

  return key && value ? { key, value } : undefined;
};

/**
 * Only returns businesses that expose a website or an email, because those are
 * the ones we can actually reach. The filtering happens server-side so we never
 * download records we would immediately discard — the biggest Overpass fair-use win.
 */
export const buildOverpassQuery = (targeting: OverpassTargeting): string => {
  const areas = targeting.areas.map(sanitizeValue).filter(Boolean);
  const categories = targeting.categories
    .map(parseCategory)
    .filter((category): category is ParsedCategory => Boolean(category));

  if (areas.length === 0 || categories.length === 0) {
    throw new Error('Overpass targeting requires at least one area and one category');
  }

  const timeout = targeting.timeoutSeconds ?? 60;
  const limit = Math.max(1, Math.min(1000, targeting.maxResults));

  // One regex clause instead of four separate contact filters. Overpass 504s on
  // large queries, and areas x categories x contacts multiplies fast — this cuts
  // the clause count fourfold for identical results.
  const hasContact = '[~"^(website|contact:website|email|contact:email)$"~"."]';

  const areaDefinitions = areas.map((area, index) => `area["name"="${area}"]->.a${index};`);

  const clauses = areas.flatMap((_area, index) =>
    categories.map(({ key, value }) => `  nwr["${key}"="${value}"]${hasContact}(area.a${index});`),
  );

  return [
    `[out:json][timeout:${timeout}];`,
    ...areaDefinitions,
    '(',
    ...clauses,
    ');',
    `out center tags ${limit};`,
  ].join('\n');
};
