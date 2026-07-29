/**
 * Discovery stops once it has enough candidates, so iterating a fixed list
 * always drains the first few areas and never reaches the rest. Rotating the
 * starting point by day means the whole list is worked through over time, and
 * an area that was exhausted yesterday is not re-queried first today.
 */
export const rotateAreas = <T>(areas: readonly T[], date = new Date()): T[] => {
  if (areas.length === 0) {
    return [];
  }

  // Days since epoch — changes once per UTC day, and is stable within a day so
  // repeated runs on the same day stay consistent.
  const dayNumber = Math.floor(date.getTime() / 86_400_000);
  const offset = ((dayNumber % areas.length) + areas.length) % areas.length;

  return [...areas.slice(offset), ...areas.slice(0, offset)];
};
