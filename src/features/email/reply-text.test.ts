import { describe, expect, it } from 'vitest';
import { extractReplyText, stripQuotedText } from './reply-text.js';

describe('stripQuotedText', () => {
  it('keeps only what the person typed above the quoted thread', () => {
    const text = [
      'Yes, interested. Can you send examples?',
      '',
      'On Tue, 28 Jul 2026 at 09:14, Abdus Salam wrote:',
      '> Hi, I build websites for small restaurants...',
    ].join('\n');

    expect(stripQuotedText(text)).toBe('Yes, interested. Can you send examples?');
  });

  it('handles Outlook style original-message separators', () => {
    const text = 'Sounds good.\n\n-----Original Message-----\nFrom: someone';

    expect(stripQuotedText(text)).toBe('Sounds good.');
  });

  it('stops at a From: header line', () => {
    expect(stripQuotedText('Not right now, thanks.\nFrom: Abdus')).toBe('Not right now, thanks.');
  });

  it('drops mobile signatures that precede the quote', () => {
    expect(stripQuotedText('Sure, call me Friday.\nSent from my iPhone')).toBe(
      'Sure, call me Friday.',
    );
  });

  it('returns the whole text when nothing is quoted', () => {
    expect(stripQuotedText('Happy to chat.')).toBe('Happy to chat.');
  });
});

describe('extractReplyText', () => {
  it('takes the body and discards the headers', () => {
    const raw = [
      'From: owner@taverna.co.uk',
      'Subject: Re: armenian taverna site',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Yes please, send over the suggestions.',
    ].join('\n');

    expect(extractReplyText(raw)).toBe('Yes please, send over the suggestions.');
  });

  it('prefers the plain-text part of a multipart message', () => {
    const raw = [
      'Subject: Re: hello',
      'Content-Type: multipart/alternative; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Interested, what would it cost?',
      '--b1',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Interested, what would it cost?</p>',
      '--b1--',
    ].join('\n');

    expect(extractReplyText(raw)).toContain('Interested, what would it cost?');
    expect(extractReplyText(raw)).not.toContain('<p>');
  });

  it('strips html when only an html part exists', () => {
    const raw = 'Subject: Re: hi\nContent-Type: text/html\n\n<p>Sounds <b>good</b>, call me.</p>';

    expect(extractReplyText(raw)).toBe('Sounds good, call me.');
  });

  it('truncates long replies with an ellipsis', () => {
    const raw = `Subject: Re: hi\n\n${'a'.repeat(3000)}`;
    const result = extractReplyText(raw, 100);

    expect(result).toHaveLength(101);
    expect(result.endsWith('…')).toBe(true);
  });

  it('undoes quoted-printable soft line breaks', () => {
    const raw = 'Subject: Re: hi\n\nThis is a very long line that was=\nwrapped by the mailer.';

    expect(extractReplyText(raw)).toBe('This is a very long line that waswrapped by the mailer.');
  });
});
