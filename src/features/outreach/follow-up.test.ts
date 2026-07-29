import { describe, expect, it } from 'vitest';
import { computeNextFollowUp, isFollowUpDue } from './follow-up.js';

const config = { enabled: true, maxSteps: 2, delayDays: [4, 7] };
const lastSentAt = new Date('2026-07-20T10:00:00Z');

const base = {
  config,
  sequenceStep: 1,
  lastSentAt,
  replied: false,
  replyDetectionHealthy: true,
};

describe('computeNextFollowUp', () => {
  it('schedules the first follow-up after the configured delay', () => {
    const result = computeNextFollowUp(base);

    expect(result).toMatchObject({ schedule: true, step: 1 });
    expect((result as { at: Date }).at.toISOString()).toBe('2026-07-24T10:00:00.000Z');
  });

  it('schedules the second follow-up with the second delay', () => {
    const result = computeNextFollowUp({ ...base, sequenceStep: 2 });

    expect(result).toMatchObject({ schedule: true, step: 2 });
    expect((result as { at: Date }).at.toISOString()).toBe('2026-07-27T10:00:00.000Z');
  });

  it('stops after the configured maximum', () => {
    expect(computeNextFollowUp({ ...base, sequenceStep: 3 })).toMatchObject({ schedule: false });
  });

  it('never follows up with someone who replied', () => {
    expect(computeNextFollowUp({ ...base, replied: true })).toMatchObject({
      schedule: false,
      reason: 'lead has already replied',
    });
  });

  it('refuses to follow up when reply detection is unhealthy', () => {
    const result = computeNextFollowUp({ ...base, replyDetectionHealthy: false });

    expect(result.schedule).toBe(false);
    expect((result as { reason: string }).reason).toContain('reply detection is unavailable');
  });

  it('does nothing when follow-ups are disabled', () => {
    expect(
      computeNextFollowUp({ ...base, config: { ...config, enabled: false } }),
    ).toMatchObject({ schedule: false });
  });

  it('does nothing before the initial email has gone out', () => {
    expect(computeNextFollowUp({ ...base, sequenceStep: 0 })).toMatchObject({ schedule: false });
  });

  it('does nothing when no delay is configured for the step', () => {
    expect(
      computeNextFollowUp({ ...base, sequenceStep: 2, config: { ...config, delayDays: [4] } }),
    ).toMatchObject({ schedule: false });
  });

  it('respects maxSteps of 0 as "no follow-ups"', () => {
    expect(
      computeNextFollowUp({ ...base, config: { ...config, maxSteps: 0 } }),
    ).toMatchObject({ schedule: false });
  });
});

describe('isFollowUpDue', () => {
  const now = new Date('2026-07-28T12:00:00Z');

  it('is due when the timestamp has passed', () => {
    expect(isFollowUpDue(new Date('2026-07-28T11:59:00Z'), now)).toBe(true);
    expect(isFollowUpDue(now, now)).toBe(true);
  });

  it('is not due in the future or when unset', () => {
    expect(isFollowUpDue(new Date('2026-07-28T12:01:00Z'), now)).toBe(false);
    expect(isFollowUpDue(null, now)).toBe(false);
    expect(isFollowUpDue(undefined, now)).toBe(false);
  });
});
