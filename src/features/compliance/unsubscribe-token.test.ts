import { describe, expect, it } from 'vitest';
import { createUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token.js';

const secret = 'test-secret-that-is-long-enough-for-hmac';
const other = 'a-completely-different-secret-value-here';

describe('unsubscribe tokens', () => {
  it('round-trips a payload', () => {
    const token = createUnsubscribeToken({ email: 'a@b.com', leadId: '507f1f77bcf86cd799439011' }, secret);

    expect(verifyUnsubscribeToken(token, secret)).toEqual({
      email: 'a@b.com',
      leadId: '507f1f77bcf86cd799439011',
    });
  });

  it('lowercases the email so suppression matching is consistent', () => {
    const token = createUnsubscribeToken({ email: 'Mixed@Case.COM', leadId: 'x' }, secret);
    expect(verifyUnsubscribeToken(token, secret)?.email).toBe('mixed@case.com');
  });

  it('rejects a token signed with a different secret', () => {
    const token = createUnsubscribeToken({ email: 'a@b.com', leadId: 'x' }, other);
    expect(verifyUnsubscribeToken(token, secret)).toBeUndefined();
  });

  it('rejects a tampered payload', () => {
    const token = createUnsubscribeToken({ email: 'victim@b.com', leadId: 'x' }, secret);
    const [, signature] = token.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ e: 'attacker@b.com', l: 'x' }))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(verifyUnsubscribeToken(`${forgedBody}.${signature}`, secret)).toBeUndefined();
  });

  it('rejects malformed tokens without throwing', () => {
    for (const token of ['', '.', 'nodot', 'a.b.c', 'garbage.garbage', '.sig', 'body.']) {
      expect(() => verifyUnsubscribeToken(token, secret)).not.toThrow();
      expect(verifyUnsubscribeToken(token, secret)).toBeUndefined();
    }
  });

  it('rejects a valid signature over a payload missing fields', () => {
    // Signed correctly, but the body has no email — must still be refused.
    const body = Buffer.from(JSON.stringify({ l: 'x' }))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const token = createUnsubscribeToken({ email: 'a@b.com', leadId: 'x' }, secret);
    const signature = token.split('.')[1];

    expect(verifyUnsubscribeToken(`${body}.${signature}`, secret)).toBeUndefined();
  });

  it('produces url-safe tokens', () => {
    const token = createUnsubscribeToken(
      { email: 'someone+tag@example.co.uk', leadId: '507f1f77bcf86cd799439011' },
      secret,
    );

    expect(token).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(encodeURIComponent(token)).toBe(token);
  });
});
