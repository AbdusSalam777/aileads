import { describe, expect, it } from 'vitest';
import { buildOverpassQuery, parseCategory } from './overpass.query.js';
import { parseOverpassResponse, type OverpassResponse } from './overpass.parse.js';

describe('parseCategory', () => {
  it('resolves friendly aliases to OSM tags', () => {
    expect(parseCategory('restaurant')).toEqual({ key: 'amenity', value: 'restaurant' });
    expect(parseCategory('hairdresser')).toEqual({ key: 'shop', value: 'hairdresser' });
    expect(parseCategory('lawyer')).toEqual({ key: 'office', value: 'lawyer' });
  });

  it('accepts explicit key=value tags', () => {
    expect(parseCategory('shop=florist')).toEqual({ key: 'shop', value: 'florist' });
  });

  it('rejects malformed categories', () => {
    expect(parseCategory('nonsense')).toBeUndefined();
    expect(parseCategory('=')).toBeUndefined();
    expect(parseCategory('')).toBeUndefined();
  });
});

describe('buildOverpassQuery', () => {
  const base = { areas: ['Manchester'], categories: ['restaurant'], maxResults: 50 };

  it('builds a query filtered to reachable businesses only', () => {
    const query = buildOverpassQuery(base);

    expect(query).toContain('[out:json]');
    expect(query).toContain('area["name"="Manchester"]->.a0;');
    expect(query).toContain('nwr["amenity"="restaurant"]');
    expect(query).toContain('out center tags 50;');
    // Contact tags are matched with one regex clause rather than four separate
    // filters, which is what keeps the query small enough for Overpass to serve.
    expect(query).toContain('[~"^(website|contact:website|email|contact:email)$"~"."]');
  });

  it('emits one clause per area/category pair, not one per contact tag', () => {
    const query = buildOverpassQuery({
      areas: ['Manchester'],
      categories: ['restaurant', 'cafe'],
      maxResults: 50,
    });

    expect(query.match(/nwr\[/g)).toHaveLength(2);
  });

  it('covers every area/category combination', () => {
    const query = buildOverpassQuery({
      areas: ['Manchester', 'Leeds'],
      categories: ['restaurant', 'cafe'],
      maxResults: 20,
    });

    expect(query).toContain('.a0');
    expect(query).toContain('.a1');
    expect(query).toContain('"amenity"="restaurant"');
    expect(query).toContain('"amenity"="cafe"');
  });

  it('strips characters that could break out of the quoted string', () => {
    const query = buildOverpassQuery({
      ...base,
      areas: ['Manchester"];out meta;//'],
    });

    const areaLine = query.split('\n').find((line) => line.startsWith('area['));
    const injected = areaLine!.slice('area["name"="'.length, areaLine!.lastIndexOf('"]'));

    // Nothing that could terminate the string or start a new statement survives,
    // so the payload stays inert inside the quoted area name.
    expect(injected).not.toMatch(/["\];]/);

    // Structure is identical to a benign input: same statement count, one area line.
    const benign = buildOverpassQuery({ ...base, areas: ['Manchester'] });
    expect(query.split(';').length).toBe(benign.split(';').length);
    expect(query.split('\n').filter((line) => line.startsWith('area[')).length).toBe(1);
  });

  it('drops categories containing injection characters', () => {
    expect(parseCategory('shop=florist"];out;')).toEqual({ key: 'shop', value: 'floristout' });
  });

  it('clamps the result limit', () => {
    expect(buildOverpassQuery({ ...base, maxResults: 99_999 })).toContain('out center tags 1000;');
    expect(buildOverpassQuery({ ...base, maxResults: 0 })).toContain('out center tags 1;');
  });

  it('throws when targeting is incomplete', () => {
    expect(() => buildOverpassQuery({ areas: [], categories: ['cafe'], maxResults: 10 })).toThrow();
    expect(() => buildOverpassQuery({ areas: ['Leeds'], categories: [], maxResults: 10 })).toThrow();
    expect(() =>
      buildOverpassQuery({ areas: ['Leeds'], categories: ['nonsense'], maxResults: 10 }),
    ).toThrow();
  });
});

describe('parseOverpassResponse', () => {
  const response: OverpassResponse = {
    elements: [
      {
        type: 'node',
        id: 1,
        tags: {
          name: 'Corner Cut Barbers',
          shop: 'hairdresser',
          website: 'cornercutbarbers.co.uk',
          'addr:street': 'Oldham Street',
          'addr:city': 'Manchester',
        },
      },
      {
        type: 'way',
        id: 2,
        tags: {
          name: 'Riverbend Bistro',
          amenity: 'restaurant',
          'contact:email': 'bookings@riverbendbistro.co.uk',
        },
      },
      { type: 'node', id: 3, tags: { name: 'No Contact Cafe', amenity: 'cafe' } },
      { type: 'node', id: 4, tags: { shop: 'bakery', website: 'https://unnamedbakery.co.uk' } },
      {
        type: 'node',
        id: 5,
        tags: { name: 'Spam Ltd', office: 'accountant', email: 'noreply@spamsignals.co.uk' },
      },
    ],
  };

  it('keeps only named businesses that are actually reachable', () => {
    const candidates = parseOverpassResponse(response);
    const names = candidates.map((candidate) => candidate.name);

    expect(names).toEqual(['Corner Cut Barbers', 'Riverbend Bistro']);
  });

  it('normalises schemeless websites to https', () => {
    const [barbers] = parseOverpassResponse(response);
    expect(barbers.websiteUrl).toBe('https://cornercutbarbers.co.uk/');
  });

  it('builds a stable external id and OSM link', () => {
    const [barbers] = parseOverpassResponse(response);

    expect(barbers.externalId).toBe('node/1');
    expect(barbers.sourceUrl).toBe('https://www.openstreetmap.org/node/1');
    expect(barbers.sourceKind).toBe('fit');
  });

  it('composes a readable address', () => {
    const [barbers] = parseOverpassResponse(response);
    expect(barbers.location).toBe('Oldham Street, Manchester');
  });

  it('extracts the category tag', () => {
    const [barbers, bistro] = parseOverpassResponse(response);

    expect(barbers.category).toBe('shop=hairdresser');
    expect(bistro.category).toBe('amenity=restaurant');
  });

  it('discards junk email tags rather than trusting them', () => {
    const spam = parseOverpassResponse(response).find((c) => c.name === 'Spam Ltd');
    expect(spam).toBeUndefined();
  });

  it('handles an empty or malformed response', () => {
    expect(parseOverpassResponse({})).toEqual([]);
    expect(parseOverpassResponse({ elements: [] })).toEqual([]);
  });
});
