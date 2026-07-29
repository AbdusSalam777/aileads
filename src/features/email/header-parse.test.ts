import { describe, expect, it } from 'vitest';
import { parseRawHeaders } from './header-parse.js';

describe('parseRawHeaders', () => {
  it('parses the raw buffer imapflow actually returns', () => {
    const raw = Buffer.from(
      'Auto-Submitted: auto-replied\r\nPrecedence: bulk\r\nReturn-Path: <>\r\n',
      'utf8',
    );

    const headers = parseRawHeaders(raw);

    expect(headers.get('auto-submitted')).toBe('auto-replied');
    expect(headers.get('precedence')).toBe('bulk');
    expect(headers.get('return-path')).toBe('<>');
  });

  it('lowercases names so lookups do not depend on sender casing', () => {
    expect(parseRawHeaders('RETURN-PATH: <bounce@x.com>').get('return-path')).toBe('<bounce@x.com>');
  });

  it('unfolds values continued on the next line', () => {
    const raw = 'Subject: a very long subject that the sender\r\n  wrapped onto a second line\r\n';

    expect(parseRawHeaders(raw).get('subject')).toBe(
      'a very long subject that the sender wrapped onto a second line',
    );
  });

  it('keeps the first occurrence of a repeated header', () => {
    expect(parseRawHeaders('Precedence: bulk\r\nPrecedence: list').get('precedence')).toBe('bulk');
  });

  it('handles values containing colons', () => {
    expect(parseRawHeaders('Return-Path: <a:b@x.com>').get('return-path')).toBe('<a:b@x.com>');
  });

  it('returns an empty map rather than throwing on missing input', () => {
    expect(parseRawHeaders(undefined).size).toBe(0);
    expect(parseRawHeaders('').size).toBe(0);
  });

  it('ignores lines that are not headers', () => {
    const headers = parseRawHeaders('not a header line\r\nPrecedence: bulk\r\n');

    expect(headers.size).toBe(1);
    expect(headers.get('precedence')).toBe('bulk');
  });
});
