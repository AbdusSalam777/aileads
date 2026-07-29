import type { SenderIdentity } from '../campaigns/campaign.model.js';

export type BuildMessageInput = {
  toEmail: string;
  subject: string;
  body: string;
  sender: SenderIdentity;
  unsubscribeUrl: string;
  /**
   * The authenticated SMTP mailbox. The From header MUST match it: providers
   * reject a From they did not authenticate, and even when one slips through it
   * fails SPF/DKIM alignment and is filed as spam.
   */
  fromAddress: string;
};

export type BuiltMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  headers: Record<string, string>;
};

const escapeQuotes = (value: string) => value.replace(/"/g, '');

/**
 * Appends the sender identity and the legally required footer. This is applied
 * server-side on every send, so neither the model nor a human editing the draft
 * can remove the unsubscribe link or the postal address.
 */
/** The body/footer only — callers rendering a preview have no From to supply. */
type MessageTextInput = Omit<BuildMessageInput, 'fromAddress'>;

export const buildMessageText = (input: MessageTextInput): string => {
  const { sender, body, unsubscribeUrl } = input;
  const signature = [sender.name, sender.title, sender.company].filter(Boolean).join(' · ');

  const footerLines = [signature];

  if (sender.portfolioUrl) {
    footerLines.push(sender.portfolioUrl);
  }

  if (sender.physicalAddress) {
    footerLines.push('', sender.physicalAddress);
  }

  footerLines.push(
    '',
    'If you would rather not hear from me again, unsubscribe here and I will not contact you:',
    unsubscribeUrl,
  );

  return `${body.trim()}\n\n--\n${footerLines.join('\n')}\n`;
};

export const buildMessage = (input: BuildMessageInput): BuiltMessage => {
  const wantsRepliesElsewhere =
    Boolean(input.sender.email) &&
    input.sender.email.trim().toLowerCase() !== input.fromAddress.trim().toLowerCase();

  return {
    from: `"${escapeQuotes(input.sender.name)}" <${input.fromAddress}>`,
    to: input.toEmail,
    subject: input.subject.trim(),
    text: buildMessageText(input),
    // Only set when the campaign genuinely wants replies at another address.
    // Note this sends replies somewhere IMAP is not watching, so they will not
    // be detected automatically.
    replyTo: wantsRepliesElsewhere ? input.sender.email : undefined,
    headers: {
      // One-click unsubscribe support improves deliverability and is expected by
      // Gmail/Yahoo bulk-sender rules.
      'List-Unsubscribe': `<${input.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'Auto-Submitted': 'auto-generated',
    },
  };
};
