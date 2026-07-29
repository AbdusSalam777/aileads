import { describe, expect, it } from 'vitest';
import { buildMessage } from './message-builder.js';

describe('From header alignment', () => {
  const base = {
    toEmail: 'lead@example.com',
    subject: 'armenian taverna site',
    body: 'Hi,\n\nShort note.',
    unsubscribeUrl: 'https://example.com/u/tok',
  };

  it('sends from the authenticated mailbox, not the campaign reply address', () => {
    // Providers reject a From they did not authenticate, and it breaks SPF.
    const built = buildMessage({
      ...base,
      fromAddress: 'info@abdusdev.com',
      sender: { name: 'Abdus Salam', email: 'abdus@gmail.com' },
    });

    expect(built.from).toBe('"Abdus Salam" <info@abdusdev.com>');
  });

  it('adds Reply-To only when the campaign wants replies elsewhere', () => {
    const elsewhere = buildMessage({
      ...base,
      fromAddress: 'info@abdusdev.com',
      sender: { name: 'Abdus Salam', email: 'abdus@gmail.com' },
    });

    expect(elsewhere.replyTo).toBe('abdus@gmail.com');
  });

  it('omits Reply-To when the reply address is the sending mailbox', () => {
    const aligned = buildMessage({
      ...base,
      fromAddress: 'info@abdusdev.com',
      sender: { name: 'Abdus Salam', email: 'info@abdusdev.com' },
    });

    expect(aligned.replyTo).toBeUndefined();
  });

  it('ignores case when comparing the two addresses', () => {
    const built = buildMessage({
      ...base,
      fromAddress: 'info@abdusdev.com',
      sender: { name: 'Abdus Salam', email: 'INFO@AbdusDev.com' },
    });

    expect(built.replyTo).toBeUndefined();
  });
});
