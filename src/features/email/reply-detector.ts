export type IncomingHeaders = {
  from?: string;
  subject?: string;
  inReplyTo?: string;
  references?: string;
  autoSubmitted?: string;
  precedence?: string;
  returnPath?: string;
  listUnsubscribe?: string;
};

export type Classification =
  | { kind: 'reply'; email: string }
  | { kind: 'bounce'; email?: string; hard: boolean }
  | { kind: 'auto_reply'; email?: string }
  | { kind: 'ignore'; reason: string };

const BOUNCE_SENDERS = /mailer-daemon|postmaster|mail delivery (subsystem|system)/i;

const HARD_BOUNCE_HINTS =
  /(550|551|553|554|5\.1\.1|5\.1\.10|5\.4\.1)|user unknown|no such user|does not exist|address rejected|recipient not found|mailbox unavailable|permanently/i;

const SOFT_BOUNCE_HINTS = /(421|450|451|452|4\.\d\.\d)|mailbox full|over quota|try again|temporar/i;

const AUTO_REPLY_SUBJECTS =
  /^(auto(matic)?[- ]?reply|out of (the )?office|ooo|away from|autoresponse|automatic response|vacation)/i;

export const extractEmailAddress = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }

  const angled = value.match(/<([^>]+)>/);
  const candidate = (angled ? angled[1] : value).trim().toLowerCase();

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : undefined;
};

/**
 * Distinguishes a genuine human reply from a bounce or an out-of-office. Getting
 * this wrong either chases someone who already answered, or silently stops a
 * sequence because of a vacation responder.
 */
export const classifyIncoming = (headers: IncomingHeaders, body = ''): Classification => {
  const from = headers.from ?? '';
  const subject = headers.subject ?? '';
  const haystack = `${subject}\n${body}`;

  if (BOUNCE_SENDERS.test(from) || /^<>$/.test(headers.returnPath?.trim() ?? '')) {
    return {
      kind: 'bounce',
      email: extractRecipientFromBounce(haystack),
      hard: HARD_BOUNCE_HINTS.test(haystack) || !SOFT_BOUNCE_HINTS.test(haystack),
    };
  }

  if (/delivery status notification|undeliverable|delivery has failed|returned mail/i.test(subject)) {
    return {
      kind: 'bounce',
      email: extractRecipientFromBounce(haystack),
      hard: HARD_BOUNCE_HINTS.test(haystack),
    };
  }

  // Vacation responders must never be treated as a reply.
  if (
    AUTO_REPLY_SUBJECTS.test(subject.replace(/^(re|fwd?):\s*/i, '')) ||
    /^(auto-(generated|replied)|auto_reply)$/i.test(headers.autoSubmitted?.trim() ?? '') ||
    /^(auto_reply|bulk|junk|list)$/i.test(headers.precedence?.trim() ?? '')
  ) {
    return { kind: 'auto_reply', email: extractEmailAddress(from) };
  }

  const email = extractEmailAddress(from);

  if (!email) {
    return { kind: 'ignore', reason: 'no parseable sender address' };
  }

  return { kind: 'reply', email };
};

const extractRecipientFromBounce = (text: string): string | undefined => {
  const patterns = [
    /final-recipient:\s*rfc822;\s*([^\s]+@[^\s]+)/i,
    /original-recipient:\s*rfc822;\s*([^\s]+@[^\s]+)/i,
    /to:\s*<?([^\s<>]+@[^\s<>]+)>?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const email = extractEmailAddress(match?.[1]);

    if (email) {
      return email;
    }
  }

  return undefined;
};
