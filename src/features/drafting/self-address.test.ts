import { describe, expect, it } from 'vitest';
import { isSelfAddress } from './drafting.service.js';
import type { CampaignDocument } from '../campaigns/campaign.model.js';

const campaign = { sender: { email: 'info@abdusdev.com' } } as CampaignDocument;

describe('isSelfAddress', () => {
  it('blocks our exact address', () => {
    expect(isSelfAddress('info@abdusdev.com', campaign)).toBe(true);
  });

  it('blocks any address on our own domain', () => {
    // Real case: scraping picked up "+info@abdusdev.com" from a page.
    expect(isSelfAddress('hello@abdusdev.com', campaign)).toBe(true);
  });

  it('is case and whitespace insensitive', () => {
    expect(isSelfAddress('  INFO@AbdusDev.com ', campaign)).toBe(true);
  });

  it('allows genuine prospects', () => {
    expect(isSelfAddress('contact@armeniantaverna.co.uk', campaign)).toBe(false);
  });

  it('does not match a domain that merely ends similarly', () => {
    expect(isSelfAddress('someone@notabdusdev.com', campaign)).toBe(false);
  });

  it('is inert when the campaign has no sender email', () => {
    expect(isSelfAddress('a@b.com', { sender: {} } as CampaignDocument)).toBe(false);
  });
});
