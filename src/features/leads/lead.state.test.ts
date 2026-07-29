import { describe, expect, it } from 'vitest';
import { ApiError } from '../../shared/api-error.js';
import { leadStatuses, type LeadStatus } from './lead.model.js';
import {
  absorbingStatuses,
  allowedTransitions,
  assertTransition,
  canReceiveOutreach,
  canTransition,
  isAbsorbing,
} from './lead.state.js';

describe('lead state machine', () => {
  it('walks the happy path end to end', () => {
    const path: LeadStatus[] = [
      'discovered',
      'enriching',
      'enriched',
      'qualifying',
      'qualified',
      'drafting',
      'contacted',
      'replied',
      'won',
    ];

    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it('allows contacted to self-loop for follow-ups', () => {
    expect(canTransition('contacted', 'contacted')).toBe(true);
  });

  it('rejects skipping pipeline stages', () => {
    expect(canTransition('discovered', 'qualified')).toBe(false);
    expect(canTransition('enriched', 'contacted')).toBe(false);
    expect(canTransition('qualified', 'replied')).toBe(false);
  });

  it('lets any live lead exit via unsubscribe, bounce or do-not-contact', () => {
    const live: LeadStatus[] = [
      'discovered',
      'enriching',
      'enriched',
      'qualifying',
      'qualified',
      'drafting',
      'contacted',
    ];

    for (const status of live) {
      expect(canTransition(status, 'unsubscribed')).toBe(true);
      expect(canTransition(status, 'bounced')).toBe(true);
      expect(canTransition(status, 'do_not_contact')).toBe(true);
    }
  });

  it('treats terminal statuses as absorbing so no further outreach happens', () => {
    for (const status of ['unsubscribed', 'bounced', 'do_not_contact', 'won', 'lost'] as const) {
      expect(isAbsorbing(status)).toBe(true);
      expect(allowedTransitions(status)).toHaveLength(0);
    }
  });

  it('never lets an absorbing status be re-entered into the pipeline', () => {
    expect(canTransition('unsubscribed', 'contacted')).toBe(false);
    expect(canTransition('bounced', 'drafting')).toBe(false);
    expect(canTransition('do_not_contact', 'enriching')).toBe(false);
    expect(canTransition('won', 'contacted')).toBe(false);
  });

  it('allows deliberate retries out of soft-failure states', () => {
    expect(canTransition('unreachable', 'enriching')).toBe(true);
    expect(canTransition('disqualified', 'qualifying')).toBe(true);
    expect(canTransition('manual_action', 'contacted')).toBe(true);
  });

  it('throws a 409 ApiError on an invalid transition', () => {
    expect(() => assertTransition('discovered', 'won')).toThrowError(ApiError);

    try {
      assertTransition('discovered', 'won');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).statusCode).toBe(409);
      expect((error as ApiError).code).toBe('INVALID_LEAD_TRANSITION');
    }
  });

  it('does not throw on a valid transition', () => {
    expect(() => assertTransition('qualified', 'drafting')).not.toThrow();
  });

  it('only permits outreach from qualified, drafting or contacted', () => {
    for (const status of leadStatuses) {
      const expected = status === 'qualified' || status === 'drafting' || status === 'contacted';
      expect(canReceiveOutreach(status)).toBe(expected);
    }
  });

  it('defines transitions for every declared status', () => {
    for (const status of leadStatuses) {
      expect(Array.isArray(allowedTransitions(status))).toBe(true);
    }
  });

  it('keeps absorbing statuses a subset of declared statuses', () => {
    for (const status of absorbingStatuses) {
      expect(leadStatuses).toContain(status);
    }
  });
});
