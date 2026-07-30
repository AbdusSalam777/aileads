import { describe, expect, it } from 'vitest';

/**
 * Mirrors the gate in qualification.service.ts. A threshold of 0 means the
 * operator reviews every draft themselves, so neither the score nor the model's
 * own "skip" is allowed to reject a lead before they see it.
 */
const passes = (recommendation: 'contact' | 'skip', score: number, threshold: number) =>
  threshold <= 0 || (recommendation === 'contact' && score >= threshold);

describe('qualification gating', () => {
  it('lets everything through when the threshold is 0', () => {
    expect(passes('skip', 0, 0)).toBe(true);
    expect(passes('skip', 40, 0)).toBe(true);
    expect(passes('contact', 90, 0)).toBe(true);
  });

  it('still honours a real threshold when one is set', () => {
    expect(passes('contact', 70, 60)).toBe(true);
    expect(passes('contact', 40, 60)).toBe(false);
  });

  it('honours a skip recommendation when gating is on', () => {
    // A high score does not override an explicit skip while the gate is active.
    expect(passes('skip', 90, 60)).toBe(false);
  });

  it('treats a negative threshold as disabled rather than inverted', () => {
    expect(passes('skip', 0, -10)).toBe(true);
  });
});
