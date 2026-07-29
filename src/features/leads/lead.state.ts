import { ApiError } from '../../shared/api-error.js';
import type { LeadStatus } from './lead.model.js';

/**
 * Statuses that permanently end outreach. Reaching one of these cancels any
 * pending drafts and blocks all future sends for that lead.
 */
export const absorbingStatuses = [
  'replied',
  'won',
  'lost',
  'unsubscribed',
  'bounced',
  'do_not_contact',
  'disqualified',
  'unreachable',
  'manual_action',
] as const;

export type AbsorbingStatus = (typeof absorbingStatuses)[number];

export const isAbsorbing = (status: LeadStatus): boolean =>
  (absorbingStatuses as readonly LeadStatus[]).includes(status);

/** Reachable from any non-absorbing status — these are events, not pipeline steps. */
const universalExits: readonly LeadStatus[] = ['unsubscribed', 'bounced', 'do_not_contact'];

const pipelineTransitions: Record<LeadStatus, readonly LeadStatus[]> = {
  discovered: ['enriching', 'manual_action', 'disqualified'],
  enriching: ['enriched', 'unreachable', 'manual_action'],
  enriched: ['qualifying', 'disqualified'],
  // 'enriched' is the retry edge: a transient model failure must not strand the lead.
  qualifying: ['qualified', 'disqualified', 'enriched'],
  qualified: ['drafting', 'disqualified'],
  drafting: ['contacted', 'qualified', 'disqualified'],
  // Self-loop covers follow-ups: sequenceStep advances without a status change.
  contacted: ['contacted', 'replied', 'lost'],
  replied: ['won', 'lost'],

  won: [],
  lost: [],
  unreachable: ['enriching'],
  disqualified: ['qualifying'],
  manual_action: ['contacted', 'lost', 'enriching'],
  unsubscribed: [],
  bounced: [],
  do_not_contact: [],
};

export const allowedTransitions = (from: LeadStatus): readonly LeadStatus[] => {
  const base = pipelineTransitions[from] ?? [];

  if (isAbsorbing(from)) {
    return base;
  }

  return [...new Set([...base, ...universalExits])];
};

export const canTransition = (from: LeadStatus, to: LeadStatus): boolean =>
  from === to ? allowedTransitions(from).includes(to) : allowedTransitions(from).includes(to);

export const assertTransition = (from: LeadStatus, to: LeadStatus): void => {
  if (!canTransition(from, to)) {
    throw new ApiError(
      409,
      `Cannot move lead from "${from}" to "${to}"`,
      'INVALID_LEAD_TRANSITION',
    );
  }
};

/** A lead may only receive new outreach drafts from these states. */
export const canReceiveOutreach = (status: LeadStatus): boolean =>
  status === 'qualified' || status === 'drafting' || status === 'contacted';
