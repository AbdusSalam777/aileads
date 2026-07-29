import { describe, expect, it } from 'vitest';
import { classifyIncoming, extractEmailAddress } from './reply-detector.js';

describe('extractEmailAddress', () => {
  it('handles display-name formats', () => {
    expect(extractEmailAddress('Jane Doe <Jane@Acme.com>')).toBe('jane@acme.com');
    expect(extractEmailAddress('jane@acme.com')).toBe('jane@acme.com');
    expect(extractEmailAddress('  <a@b.co>  ')).toBe('a@b.co');
  });

  it('returns undefined for junk', () => {
    expect(extractEmailAddress(undefined)).toBeUndefined();
    expect(extractEmailAddress('not an address')).toBeUndefined();
    expect(extractEmailAddress('')).toBeUndefined();
  });
});

describe('classifyIncoming', () => {
  it('treats a normal human response as a reply', () => {
    expect(
      classifyIncoming({ from: 'Dave <dave@buildco.com>', subject: 'Re: your website' }),
    ).toEqual({ kind: 'reply', email: 'dave@buildco.com' });
  });

  it('detects an out-of-office as an auto reply, NOT a reply', () => {
    for (const subject of [
      'Automatic reply: away until Monday',
      'Out of Office: Jane Doe',
      'Re: Out of office',
      'Auto-Reply: on leave',
      'Vacation notice',
    ]) {
      const result = classifyIncoming({ from: 'jane@acme.com', subject });
      expect(result.kind).toBe('auto_reply');
    }
  });

  it('detects auto replies signalled only by headers', () => {
    expect(
      classifyIncoming({ from: 'a@b.com', subject: 'Thanks', autoSubmitted: 'auto-replied' }).kind,
    ).toBe('auto_reply');

    expect(
      classifyIncoming({ from: 'a@b.com', subject: 'Thanks', precedence: 'bulk' }).kind,
    ).toBe('auto_reply');
  });

  it('detects a hard bounce from mailer-daemon', () => {
    const result = classifyIncoming(
      {
        from: 'Mail Delivery Subsystem <MAILER-DAEMON@googlemail.com>',
        subject: 'Delivery Status Notification (Failure)',
      },
      'Final-Recipient: rfc822; missing@nowhere.com\n550 5.1.1 The email account that you tried to reach does not exist.',
    );

    expect(result.kind).toBe('bounce');
    expect(result).toMatchObject({ hard: true, email: 'missing@nowhere.com' });
  });

  it('treats a full mailbox as a soft bounce', () => {
    const result = classifyIncoming(
      { from: 'MAILER-DAEMON@acme.com', subject: 'Undeliverable' },
      'Final-Recipient: rfc822; full@acme.com\n452 4.2.2 mailbox full, try again later',
    );

    expect(result).toMatchObject({ kind: 'bounce', hard: false });
  });

  it('detects a bounce from an empty return path', () => {
    expect(
      classifyIncoming({ from: 'noreply@x.com', subject: 'Undeliverable', returnPath: '<>' }).kind,
    ).toBe('bounce');
  });

  it('ignores mail with no parseable sender', () => {
    expect(classifyIncoming({ from: 'garbage', subject: 'hi' })).toMatchObject({ kind: 'ignore' });
  });

  it('does not mistake a genuine reply mentioning "out of office" mid-sentence', () => {
    const result = classifyIncoming(
      { from: 'dave@buildco.com', subject: 'Re: your website' },
      'I was out of office last week, but yes please send the suggestions.',
    );

    expect(result).toEqual({ kind: 'reply', email: 'dave@buildco.com' });
  });
});
