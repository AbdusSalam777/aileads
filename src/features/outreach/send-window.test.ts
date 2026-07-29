import { describe, expect, it } from 'vitest';
import {
  canSendNow,
  computeNextSendAt,
  localDayKey,
  toSendWindowConfig,
  zonedParts,
  type SendWindowConfig,
} from './send-window.js';

const config: SendWindowConfig = {
  dailyCap: 8,
  minSpacingMinutes: 45,
  maxSpacingMinutes: 180,
  startHour: 9,
  endHour: 17,
  days: [1, 2, 3, 4, 5],
  timezone: 'Europe/London',
};

// 2026-07-28 is a Tuesday. 11:00 UTC == 12:00 London (BST).
const tuesdayMidday = new Date('2026-07-28T11:00:00Z');

const allow = (overrides: Partial<Parameters<typeof canSendNow>[0]> = {}) =>
  canSendNow({
    now: tuesdayMidday,
    config,
    sentToday: 0,
    lastSentAt: null,
    outreachEnabled: true,
    ...overrides,
  });

describe('zonedParts', () => {
  it('converts into the target timezone', () => {
    expect(zonedParts(tuesdayMidday, 'Europe/London')).toMatchObject({ hour: 12, weekday: 2 });
    expect(zonedParts(tuesdayMidday, 'UTC')).toMatchObject({ hour: 11, weekday: 2 });
    expect(zonedParts(tuesdayMidday, 'America/New_York')).toMatchObject({ hour: 7, weekday: 2 });
  });

  it('falls back to UTC for an unknown timezone instead of throwing', () => {
    expect(() => zonedParts(tuesdayMidday, 'Not/AZone')).not.toThrow();
    expect(zonedParts(tuesdayMidday, 'Not/AZone').hour).toBe(11);
  });

  it('normalises midnight to hour 0', () => {
    expect(zonedParts(new Date('2026-01-15T00:30:00Z'), 'UTC').hour).toBe(0);
  });
});

describe('localDayKey', () => {
  it('is stable within a timezone day', () => {
    const morning = new Date('2026-07-28T08:00:00Z');
    const evening = new Date('2026-07-28T20:00:00Z');

    expect(localDayKey(morning, 'Europe/London')).toBe(localDayKey(evening, 'Europe/London'));
    expect(localDayKey(morning, 'Europe/London')).toBe('2026-07-28');
  });

  it('rolls over at local midnight, not UTC midnight', () => {
    // 23:30 New York on the 28th is 03:30 UTC on the 29th.
    const lateNight = new Date('2026-07-29T03:30:00Z');

    expect(localDayKey(lateNight, 'America/New_York')).toBe('2026-07-28');
    expect(localDayKey(lateNight, 'UTC')).toBe('2026-07-29');
  });
});

describe('canSendNow', () => {
  it('allows a send inside the window', () => {
    expect(allow()).toEqual({ allowed: true });
  });

  it('blocks when outreach is disabled', () => {
    expect(allow({ outreachEnabled: false })).toMatchObject({
      allowed: false,
      code: 'OUTREACH_DISABLED',
    });
  });

  it('blocks at the daily cap', () => {
    expect(allow({ sentToday: 8 })).toMatchObject({ allowed: false, code: 'DAILY_CAP_REACHED' });
    expect(allow({ sentToday: 9 })).toMatchObject({ allowed: false, code: 'DAILY_CAP_REACHED' });
    expect(allow({ sentToday: 7 })).toEqual({ allowed: true });
  });

  it('blocks on a disabled day', () => {
    // 2026-08-01 is a Saturday.
    expect(allow({ now: new Date('2026-08-01T11:00:00Z') })).toMatchObject({
      allowed: false,
      code: 'OUTSIDE_SEND_DAYS',
    });
  });

  it('blocks outside business hours in the campaign timezone', () => {
    // 07:00 UTC = 08:00 London, before the 09:00 start.
    expect(allow({ now: new Date('2026-07-28T07:00:00Z') })).toMatchObject({
      allowed: false,
      code: 'OUTSIDE_SEND_HOURS',
    });

    // 16:30 UTC = 17:30 London, after the 17:00 end.
    expect(allow({ now: new Date('2026-07-28T16:30:00Z') })).toMatchObject({
      allowed: false,
      code: 'OUTSIDE_SEND_HOURS',
    });
  });

  it('treats the end hour as exclusive and the start hour as inclusive', () => {
    // 08:00 UTC = 09:00 London exactly.
    expect(allow({ now: new Date('2026-07-28T08:00:00Z') })).toEqual({ allowed: true });
    // 16:00 UTC = 17:00 London exactly.
    expect(allow({ now: new Date('2026-07-28T16:00:00Z') })).toMatchObject({
      allowed: false,
      code: 'OUTSIDE_SEND_HOURS',
    });
  });

  it('enforces minimum spacing between sends', () => {
    const tenMinutesAgo = new Date(tuesdayMidday.getTime() - 10 * 60_000);
    const hourAgo = new Date(tuesdayMidday.getTime() - 60 * 60_000);

    expect(allow({ lastSentAt: tenMinutesAgo })).toMatchObject({ allowed: false, code: 'TOO_SOON' });
    expect(allow({ lastSentAt: hourAgo })).toEqual({ allowed: true });
  });

  it('checks the cap before anything else so a full day is unambiguous', () => {
    const result = allow({ sentToday: 99, now: new Date('2026-08-01T23:00:00Z') });
    expect(result).toMatchObject({ code: 'DAILY_CAP_REACHED' });
  });

  it('respects a non-UTC campaign timezone', () => {
    const nyConfig = { ...config, timezone: 'America/New_York' };

    // 12:00 UTC = 08:00 New York — too early there, fine in London.
    expect(
      canSendNow({
        now: new Date('2026-07-28T12:00:00Z'),
        config: nyConfig,
        sentToday: 0,
        outreachEnabled: true,
      }),
    ).toMatchObject({ allowed: false, code: 'OUTSIDE_SEND_HOURS' });
  });
});

describe('toSendWindowConfig', () => {
  it('copies every field explicitly', () => {
    expect(toSendWindowConfig(config)).toEqual(config);
  });

  it('clamps the daily cap to the hard ceiling but never raises it', () => {
    expect(toSendWindowConfig({ ...config, dailyCap: 40 }, 8).dailyCap).toBe(8);
    expect(toSendWindowConfig({ ...config, dailyCap: 3 }, 8).dailyCap).toBe(3);
  });

  it('copies the days array rather than aliasing it', () => {
    const mapped = toSendWindowConfig(config);
    mapped.days.push(6);

    expect(config.days).not.toContain(6);
  });
});

describe('computeNextSendAt', () => {
  it('respects the configured spacing range', () => {
    const min = computeNextSendAt(tuesdayMidday, config, () => 0);
    const max = computeNextSendAt(tuesdayMidday, config, () => 0.999999);

    expect((min.getTime() - tuesdayMidday.getTime()) / 60_000).toBeCloseTo(45, 0);
    expect((max.getTime() - tuesdayMidday.getTime()) / 60_000).toBeCloseTo(180, 0);
  });

  it('always lands inside an allowed window', () => {
    for (let i = 0; i < 40; i += 1) {
      const next = computeNextSendAt(tuesdayMidday, config);
      const local = zonedParts(next, config.timezone);

      expect(config.days).toContain(local.weekday);
      expect(local.hour).toBeGreaterThanOrEqual(config.startHour);
      expect(local.hour).toBeLessThan(config.endHour);
    }
  });

  it('throws instead of returning an Invalid Date when spacing is missing', () => {
    // Regression: spreading a Mongoose subdocument drops these fields, which
    // previously surfaced as an opaque "Invalid time value" from Intl.
    const broken = { ...config, minSpacingMinutes: undefined as unknown as number };

    expect(() => computeNextSendAt(tuesdayMidday, broken)).toThrow(/spacing is not configured/i);
  });

  it('rolls a Friday evening send into the following Monday', () => {
    // 2026-07-31 is a Friday; 15:50 UTC = 16:50 London, so +45min falls past close.
    const next = computeNextSendAt(new Date('2026-07-31T15:50:00Z'), config, () => 0);
    const local = zonedParts(next, config.timezone);

    expect(local.weekday).toBe(1);
    expect(local.hour).toBeGreaterThanOrEqual(9);
  });
});
