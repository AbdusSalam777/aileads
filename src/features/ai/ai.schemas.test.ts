import { describe, expect, it } from 'vitest';
import { qualificationOutputSchema } from './ai.schemas.js';

const base = {
  score: 72,
  tier: 'warm',
  reasons: ['Site is not mobile responsive'],
  recommendation: 'contact',
};

describe('qualificationOutputSchema', () => {
  it('truncates an over-long serviceFit label instead of rejecting the response', () => {
    // Groq really does return sentences here, which previously failed every lead.
    const verbose = 'website redesign and rebuild including mobile responsiveness and performance work';

    const result = qualificationOutputSchema.parse({ ...base, serviceFit: [verbose] });

    expect(result.serviceFit[0]).toHaveLength(60);
    expect(result.serviceFit[0].endsWith('…')).toBe(true);
  });

  it('leaves labels within the limit untouched', () => {
    const result = qualificationOutputSchema.parse({ ...base, serviceFit: ['web development'] });

    expect(result.serviceFit).toEqual(['web development']);
  });

  it('truncates long reasons rather than failing', () => {
    const result = qualificationOutputSchema.parse({ ...base, reasons: ['x'.repeat(400)] });

    expect(result.reasons[0]).toHaveLength(300);
  });

  it('still rejects genuinely invalid output', () => {
    expect(() => qualificationOutputSchema.parse({ ...base, score: 'abc' })).toThrow();
    expect(() => qualificationOutputSchema.parse({ ...base, recommendation: 'maybe' })).toThrow();
  });
});
