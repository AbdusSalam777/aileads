import { describe, expect, it } from 'vitest';
import { rotateAreas } from './area-rotation.js';

describe('rotateAreas', () => {
  const areas = ['Manchester', 'Birmingham', 'Leeds', 'Liverpool'];

  it('returns every area, only reordered', () => {
    const rotated = rotateAreas(areas, new Date('2026-07-29T00:00:00Z'));

    expect(rotated).toHaveLength(areas.length);
    expect([...rotated].sort()).toEqual([...areas].sort());
  });

  it('starts at a different area on consecutive days', () => {
    const day1 = rotateAreas(areas, new Date('2026-07-29T06:00:00Z'))[0];
    const day2 = rotateAreas(areas, new Date('2026-07-30T06:00:00Z'))[0];

    expect(day1).not.toBe(day2);
  });

  it('is stable within the same day, so repeated runs agree', () => {
    const morning = rotateAreas(areas, new Date('2026-07-29T06:00:00Z'));
    const evening = rotateAreas(areas, new Date('2026-07-29T23:00:00Z'));

    expect(morning).toEqual(evening);
  });

  it('cycles back round after a full pass', () => {
    const first = rotateAreas(areas, new Date('2026-07-29T00:00:00Z'));
    const afterFullCycle = rotateAreas(areas, new Date('2026-08-02T00:00:00Z'));

    expect(afterFullCycle).toEqual(first);
  });

  it('covers every area as the starting point across a cycle', () => {
    const starts = new Set<string>();

    for (let day = 0; day < areas.length; day += 1) {
      const date = new Date(Date.UTC(2026, 6, 29 + day));
      starts.add(rotateAreas(areas, date)[0]);
    }

    expect(starts.size).toBe(areas.length);
  });

  it('handles an empty list', () => {
    expect(rotateAreas([], new Date())).toEqual([]);
  });
});
