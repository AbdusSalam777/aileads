import { describe, expect, it } from 'vitest';
import { isWithinCountry } from './country-bounds.js';

describe('isWithinCountry', () => {
  const edinburghScotland = { lat: 55.9533, lon: -3.1883 };
  const edinburghIndiana = { lat: 39.3542, lon: -85.9647 };

  it('keeps a business in the targeted country', () => {
    expect(isWithinCountry(edinburghScotland, 'GB')).toBe(true);
  });

  it('rejects the same-named place on another continent', () => {
    // This is the exact failure that put US businesses in a UK campaign.
    expect(isWithinCountry(edinburghIndiana, 'GB')).toBe(false);
  });

  it('is case insensitive on the country code', () => {
    expect(isWithinCountry(edinburghScotland, 'gb')).toBe(true);
  });

  it('keeps everything when no country is configured', () => {
    expect(isWithinCountry(edinburghIndiana, undefined)).toBe(true);
  });

  it('keeps everything for a country it has no bounds for', () => {
    expect(isWithinCountry(edinburghIndiana, 'ZZ')).toBe(true);
  });

  it('keeps elements with no coordinates rather than silently dropping leads', () => {
    expect(isWithinCountry({}, 'GB')).toBe(true);
    expect(isWithinCountry(undefined, 'GB')).toBe(true);
  });

  it('places Manchester and London inside GB', () => {
    expect(isWithinCountry({ lat: 53.4808, lon: -2.2426 }, 'GB')).toBe(true);
    expect(isWithinCountry({ lat: 51.5072, lon: -0.1276 }, 'GB')).toBe(true);
  });
});
