import { describe, expect, it } from 'vitest';
import { buildMessageText } from './message-builder.js';

describe('buildMessageText', () => {
  const base = {
    body: 'Hi,\n\nShort note.',
    unsubscribeUrl: 'https://example.com/u/tok',
    sender: { name: 'Abdus Salam', email: 'info@abdusdev.com' },
  };

  it('always appends the unsubscribe link, regardless of who sends the message', () => {
    // The system no longer sends email itself — this link is what stays true
    // no matter where the operator pastes the body afterwards.
    expect(buildMessageText(base)).toContain(base.unsubscribeUrl);
  });

  it('includes the postal address when one is set', () => {
    const withAddress = buildMessageText({
      ...base,
      sender: { ...base.sender, physicalAddress: '5-D Street 7, Lahore' },
    });

    expect(withAddress).toContain('5-D Street 7, Lahore');
  });

  it('omits the address line entirely when none is set', () => {
    expect(buildMessageText(base)).not.toContain('undefined');
  });

  it('signs off with name and title when both are present', () => {
    const signed = buildMessageText({
      ...base,
      sender: { ...base.sender, title: 'Freelance developer' },
    });

    expect(signed).toContain('Abdus Salam · Freelance developer');
  });

  it('preserves the body text unmodified above the footer', () => {
    const rendered = buildMessageText(base);
    expect(rendered.startsWith(base.body)).toBe(true);
  });
});
