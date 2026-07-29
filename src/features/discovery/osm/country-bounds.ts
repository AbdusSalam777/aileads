/**
 * Place names are not unique worldwide: area["name"="Edinburgh"] also resolves
 * to Edinburgh, Indiana, which quietly filled a UK-targeted campaign with
 * American businesses. Overpass could not be made to scope this reliably — a
 * country-area intersection times out, and a bbox on the area statement is
 * ignored — so results are filtered here, against coordinates we can check.
 *
 * Bounds are [south, west, north, east], generous enough to include every
 * settlement in the country.
 */
export const COUNTRY_BOUNDS: Record<string, [number, number, number, number]> = {
  GB: [49.8, -8.7, 60.9, 1.8],
  IE: [51.4, -10.6, 55.4, -5.9],
  US: [24.4, -125.0, 49.4, -66.9],
  CA: [41.6, -141.0, 70.0, -52.6],
  AU: [-43.7, 112.9, -10.0, 153.7],
  NZ: [-47.3, 166.4, -34.4, 178.6],
  PK: [23.6, 60.8, 37.1, 77.1],
};

export const isWithinCountry = (
  coords: { lat?: number; lon?: number } | undefined,
  countryCode: string | undefined,
): boolean => {
  if (!countryCode) {
    return true;
  }

  const bounds = COUNTRY_BOUNDS[countryCode.toUpperCase()];

  if (!bounds) {
    return true;
  }

  // Without coordinates we cannot prove the element is in the wrong country,
  // and discarding it would silently lose valid leads.
  if (coords?.lat === undefined || coords?.lon === undefined) {
    return true;
  }

  const [south, west, north, east] = bounds;
  return coords.lat >= south && coords.lat <= north && coords.lon >= west && coords.lon <= east;
};
