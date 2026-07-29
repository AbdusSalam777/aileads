export type FollowUpConfigInput = {
  enabled: boolean;
  maxSteps: number;
  delayDays: number[];
};

export type FollowUpDecision =
  | { schedule: true; at: Date; step: number }
  | { schedule: false; reason: string };

export type ComputeFollowUpInput = {
  config: FollowUpConfigInput;
  /** How many messages have already been sent to this lead. */
  sequenceStep: number;
  lastSentAt: Date;
  replied: boolean;
  /** IMAP must be healthy, otherwise a reply could have arrived unseen. */
  replyDetectionHealthy: boolean;
};

/**
 * Decides whether a follow-up is due. Deliberately conservative: if we cannot
 * confirm the lead has not already replied, we do not chase them. Following up
 * with someone who already answered is the worst possible outcome.
 */
export const computeNextFollowUp = (input: ComputeFollowUpInput): FollowUpDecision => {
  const { config, sequenceStep, lastSentAt, replied, replyDetectionHealthy } = input;

  if (!config.enabled) {
    return { schedule: false, reason: 'follow-ups are disabled' };
  }

  if (replied) {
    return { schedule: false, reason: 'lead has already replied' };
  }

  if (!replyDetectionHealthy) {
    return {
      schedule: false,
      reason: 'reply detection is unavailable, so a follow-up could reach someone who replied',
    };
  }

  if (sequenceStep < 1) {
    return { schedule: false, reason: 'no initial email has been sent yet' };
  }

  if (sequenceStep > config.maxSteps) {
    return { schedule: false, reason: `follow-up limit of ${config.maxSteps} reached` };
  }

  const delayDays = config.delayDays[sequenceStep - 1];

  if (delayDays === undefined) {
    return { schedule: false, reason: 'no delay configured for this step' };
  }

  return {
    schedule: true,
    step: sequenceStep,
    at: new Date(lastSentAt.getTime() + delayDays * 24 * 60 * 60_000),
  };
};

export const isFollowUpDue = (nextFollowUpAt: Date | null | undefined, now: Date): boolean =>
  Boolean(nextFollowUpAt) && nextFollowUpAt!.getTime() <= now.getTime();
