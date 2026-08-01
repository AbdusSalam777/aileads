import type { SenderIdentity } from '../campaigns/campaign.model.js';

export type MessageTextInput = {
  body: string;
  sender: SenderIdentity;
  unsubscribeUrl: string;
};

/**
 * Appends the sender identity and the legally required footer. This is applied
 * whenever a message is rendered — preview, export — so neither the model nor
 * a human editing the draft can produce an email missing the unsubscribe link
 * or the postal address, regardless of where it is actually sent from.
 */
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
