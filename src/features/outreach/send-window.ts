export type SendWindowConfig = {
  dailyCap: number;
  minSpacingMinutes: number;
  maxSpacingMinutes: number;
  startHour: number;
  endHour: number;
  days: number[];
  timezone: string;
};

/**
 * Reads each field explicitly. Spreading a Mongoose subdocument (`{...campaign.sending}`)
 * does NOT copy its fields, which silently yields undefined spacing values and
 * an "Invalid time value" further down.
 */
export const toSendWindowConfig = (
  sending: SendWindowConfig,
  hardCapCeiling?: number,
): SendWindowConfig => ({
  dailyCap:
    hardCapCeiling === undefined ? sending.dailyCap : Math.min(sending.dailyCap, hardCapCeiling),
  minSpacingMinutes: sending.minSpacingMinutes,
  maxSpacingMinutes: sending.maxSpacingMinutes,
  startHour: sending.startHour,
  endHour: sending.endHour,
  days: [...sending.days],
  timezone: sending.timezone,
});

export type SendDecision =
  | { allowed: true }
  | { allowed: false; code: SendBlockCode; reason: string };

export type SendBlockCode =
  | 'OUTREACH_DISABLED'
  | 'DAILY_CAP_REACHED'
  | 'OUTSIDE_SEND_DAYS'
  | 'OUTSIDE_SEND_HOURS'
  | 'TOO_SOON';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

/**
 * "Today" and "business hours" must be evaluated in the campaign's timezone.
 * Using UTC would silently reset the daily cap mid-afternoon for most users.
 */
export const zonedParts = (date: Date, timeZone: string): ZonedParts => {
  let parts: Intl.DateTimeFormatPart[];

  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    }).formatToParts(date);
  } catch {
    // Unknown timezone falls back to UTC rather than throwing mid-send.
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    }).formatToParts(date);
  }

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const hour = Number.parseInt(get('hour'), 10);

  return {
    year: Number.parseInt(get('year'), 10),
    month: Number.parseInt(get('month'), 10),
    day: Number.parseInt(get('day'), 10),
    // Some locales render midnight as 24.
    hour: hour === 24 ? 0 : hour,
    minute: Number.parseInt(get('minute'), 10),
    weekday: Math.max(0, WEEKDAYS.indexOf(get('weekday'))),
  };
};

/** Stable per-timezone day key used to count what has already been sent today. */
export const localDayKey = (date: Date, timeZone: string): string => {
  const { year, month, day } = zonedParts(date, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

export type CanSendInput = {
  now: Date;
  config: SendWindowConfig;
  sentToday: number;
  lastSentAt?: Date | null;
  outreachEnabled: boolean;
};

/**
 * Every gate is re-checked immediately before each send. Together with the
 * one-message-per-tick sender, this makes a burst structurally impossible.
 */
export const canSendNow = (input: CanSendInput): SendDecision => {
  const { now, config, sentToday, lastSentAt } = input;

  if (!input.outreachEnabled) {
    return { allowed: false, code: 'OUTREACH_DISABLED', reason: 'Outreach is turned off' };
  }

  if (sentToday >= config.dailyCap) {
    return {
      allowed: false,
      code: 'DAILY_CAP_REACHED',
      reason: `Daily cap reached (${sentToday}/${config.dailyCap})`,
    };
  }

  const local = zonedParts(now, config.timezone);

  if (!config.days.includes(local.weekday)) {
    return {
      allowed: false,
      code: 'OUTSIDE_SEND_DAYS',
      reason: `${WEEKDAYS[local.weekday]} is not an enabled sending day`,
    };
  }

  if (local.hour < config.startHour || local.hour >= config.endHour) {
    return {
      allowed: false,
      code: 'OUTSIDE_SEND_HOURS',
      reason: `Local time ${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')} is outside ${config.startHour}:00-${config.endHour}:00`,
    };
  }

  if (lastSentAt) {
    const elapsedMinutes = (now.getTime() - lastSentAt.getTime()) / 60_000;

    if (elapsedMinutes < config.minSpacingMinutes) {
      const waitMinutes = Math.ceil(config.minSpacingMinutes - elapsedMinutes);
      return {
        allowed: false,
        code: 'TOO_SOON',
        reason: `Only ${Math.floor(elapsedMinutes)} min since the last send; waiting ${waitMinutes} more`,
      };
    }
  }

  return { allowed: true };
};

/**
 * Randomised gap so the sending pattern does not look mechanical, clamped into
 * the next allowed business-hours slot.
 */
export const computeNextSendAt = (
  from: Date,
  config: SendWindowConfig,
  random: () => number = Math.random,
): Date => {
  // Fail loudly rather than returning an Invalid Date that surfaces much later
  // as an opaque "Invalid time value" from Intl.
  if (!Number.isFinite(config.minSpacingMinutes) || !Number.isFinite(config.maxSpacingMinutes)) {
    throw new Error(
      'Send window spacing is not configured; the campaign sending config may not have been mapped correctly',
    );
  }

  const spread = Math.max(0, config.maxSpacingMinutes - config.minSpacingMinutes);
  const gapMinutes = config.minSpacingMinutes + Math.floor(random() * (spread + 1));

  let candidate = new Date(from.getTime() + gapMinutes * 60_000);

  // Walk forward until the candidate lands on an enabled day inside the window.
  for (let i = 0; i < 24 * 14; i += 1) {
    const local = zonedParts(candidate, config.timezone);

    if (config.days.includes(local.weekday) && local.hour >= config.startHour && local.hour < config.endHour) {
      return candidate;
    }

    candidate = new Date(candidate.getTime() + 60 * 60_000);
  }

  return candidate;
};
