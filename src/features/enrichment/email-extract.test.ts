import { describe, expect, it } from 'vitest';
import { extractEmails, isJunkEmail, pickBestEmail, scoreEmail } from './email-extract.js';

describe('isJunkEmail', () => {
  it('rejects automated mailboxes', () => {
    for (const email of [
      'noreply@acme.com',
      'no-reply@acme.com',
      'donotreply@acme.com',
      'postmaster@acme.com',
      'bounce@acme.com',
      'notifications@acme.com',
    ]) {
      expect(isJunkEmail(email)).toBe(true);
    }
  });

  it('rejects placeholder addresses from templates and docs', () => {
    for (const email of [
      'you@example.com',
      'name@domain.com',
      'test@test.com',
      'youremail@yourdomain.com',
      'someone@mysite.com',
    ]) {
      expect(isJunkEmail(email)).toBe(true);
    }
  });

  it('rejects asset filenames that look like emails', () => {
    for (const email of ['logo@2x.png', 'icon@3x.jpg', 'sprite@2x.svg', 'hero@2x.webp']) {
      expect(isJunkEmail(email)).toBe(true);
    }
  });

  it('rejects vendor and CDN domains', () => {
    for (const email of ['a@sentry.io', 'b@wixpress.com', 'c@googleapis.com', 'd@wordpress.org']) {
      expect(isJunkEmail(email)).toBe(true);
    }
  });

  it('rejects hashed tracking addresses', () => {
    expect(isJunkEmail('a1b2c3d4e5f60718293a4b5c@tracking.net')).toBe(true);
  });

  it('accepts genuine business addresses', () => {
    for (const email of [
      'hello@acmestudio.com',
      'jane.doe@lawfirm.co.uk',
      'contact@bakery.ie',
      'info@garage.de',
    ]) {
      expect(isJunkEmail(email)).toBe(false);
    }
  });
});

describe('extractEmails', () => {
  it('pulls addresses out of messy text and dedupes them', () => {
    const text = `
      Contact us at Hello@Acme.com or hello@acme.com.
      Our support is support@acme.com; do not reply to noreply@acme.com.
      <img src="logo@2x.png">
    `;

    expect(extractEmails(text).sort()).toEqual(['hello@acme.com', 'support@acme.com']);
  });

  it('strips trailing punctuation', () => {
    expect(extractEmails('Email jane@acme.com, thanks.')).toEqual(['jane@acme.com']);
  });

  it('returns an empty array when nothing usable is present', () => {
    expect(extractEmails('No contact details here at all.')).toEqual([]);
    expect(extractEmails('Only noreply@acme.com here')).toEqual([]);
  });

  it('finds addresses inside mailto links', () => {
    expect(extractEmails('<a href="mailto:owner@shop.com">Email us</a>')).toEqual([
      'owner@shop.com',
    ]);
  });
});

describe('scoreEmail', () => {
  it('ranks a personal name above a generic role mailbox', () => {
    expect(scoreEmail('jane.doe@acme.com')).toBeGreaterThan(scoreEmail('support@acme.com'));
    expect(scoreEmail('hello@acme.com')).toBeGreaterThan(scoreEmail('billing@acme.com'));
  });

  it('rewards addresses on the business own domain', () => {
    const onDomain = scoreEmail('hello@acme.com', 'https://www.acme.com/contact');
    const offDomain = scoreEmail('hello@gmail.com', 'https://www.acme.com/contact');

    expect(onDomain).toBeGreaterThan(offDomain);
  });

  it('stays within 0..1', () => {
    for (const email of ['jane@acme.com', 'billing@acme.com', 'hello@acme.com']) {
      const value = scoreEmail(email, 'https://acme.com');
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('pickBestEmail', () => {
  it('chooses the highest-confidence address', () => {
    const text = 'Reach billing@acme.com or hello@acme.com or jane.doe@acme.com';
    const picked = pickBestEmail(text, 'https://acme.com');

    expect(picked?.email).toBe('jane.doe@acme.com');
    expect(picked?.confidence).toBeGreaterThan(0.5);
  });

  it('returns undefined when only junk is present', () => {
    expect(pickBestEmail('noreply@acme.com and logo@2x.png')).toBeUndefined();
  });
});

describe('scrape artefacts', () => {
  it('strips a leading separator left by run-together text', () => {
    // Real case: a scraped page yielded "+info@abdusdev.com".
    expect(extractEmails('Contact: +info@abdusdev.com')).toContain('info@abdusdev.com');
  });

  it('keeps legitimate plus-addressing intact', () => {
    expect(extractEmails('mail sales+web@example.co.uk now')).toContain('sales+web@example.co.uk');
  });

  it('rejects press and media desks', () => {
    expect(isJunkEmail('pressemea@starbucks.com')).toBe(true);
    expect(isJunkEmail('press@bigcorp.com')).toBe(true);
    expect(isJunkEmail('media@bigcorp.com')).toBe(true);
  });

  it('rejects recruitment addresses, which never buy freelance work', () => {
    expect(isJunkEmail('careers@bigcorp.com')).toBe(true);
    expect(isJunkEmail('hr@bigcorp.com')).toBe(true);
  });

  it('still accepts ordinary business contacts', () => {
    expect(isJunkEmail('contact@armeniantaverna.co.uk')).toBe(false);
    expect(isJunkEmail('info@localshop.co.uk')).toBe(false);
  });
});
