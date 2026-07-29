const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Local parts that are never a human who can buy from us. */
const JUNK_LOCAL_PARTS = new Set([
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'postmaster',
  'mailer-daemon',
  'abuse',
  'webmaster',
  'hostmaster',
  'unsubscribe',
  'bounce',
  'bounces',
  'notifications',
  'notification',
  'automated',
  'root',
  'daemon',
  'example',
  'email',
  'your',
  'youremail',
  'name',
  'username',
  'user',
  'firstname',
  'lastname',
  'test',
  'testing',
  'sample',
  'placeholder',
  // Media and investor desks. Real addresses, but pitching freelance work to a
  // press office is pure spam and damages sender reputation.
  'press',
  'pressoffice',
  'pressemea',
  'media',
  'mediarelations',
  'newsroom',
  'journalist',
  'investor',
  'investors',
  'ir',
  'legal',
  'privacy',
  'compliance',
  'security',
  'dpo',
  'gdpr',
  'careers',
  'jobs',
  'recruitment',
  'hr',
]);

/** Domains that belong to tooling, CDNs or docs rather than the business itself. */
const JUNK_DOMAINS = [
  'example.com',
  'example.org',
  'example.net',
  'domain.com',
  'yourdomain.com',
  'yoursite.com',
  'email.com',
  'test.com',
  'sentry.io',
  'wixpress.com',
  'wix.com',
  'squarespace.com',
  'godaddy.com',
  'shopify.com',
  'wordpress.org',
  'wordpress.com',
  'w3.org',
  'schema.org',
  'googleapis.com',
  'gstatic.com',
  'cloudflare.com',
  'jquery.com',
  'bootstrapcdn.com',
  'fontawesome.com',
  'adobe.com',
  'mysite.com',
  'company.com',
  'business.com',
  'gravatar.com',
  'sentry-cdn.com',
];

const ASSET_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|eot|mp4|webm|pdf)$/i;

/** Ranked best-first: how likely this mailbox reaches a decision maker. */
const ROLE_SCORES: Array<[RegExp, number]> = [
  [/^(hello|hi|hey)$/, 0.8],
  [/^(contact|enquiries|inquiries|enquiry)$/, 0.75],
  [/^(info|mail|office)$/, 0.65],
  [/^(sales|business|bd|partnerships)$/, 0.6],
  [/^(hire|hiring|jobs|careers|recruit\w*)$/, 0.55],
  [/^(support|help|service|admin)$/, 0.4],
  [/^(billing|accounts|invoices|finance)$/, 0.25],
  [/^(press|media|marketing)$/, 0.35],
];

export const isJunkEmail = (email: string): boolean => {
  const value = email.trim().toLowerCase();

  if (!value.includes('@') || value.length > 254) {
    return true;
  }

  // "logo@2x.png" and friends match the email shape but are asset filenames.
  if (ASSET_EXTENSIONS.test(value)) {
    return true;
  }

  const [localPart, domain] = value.split('@');

  if (!localPart || !domain) {
    return true;
  }

  if (JUNK_LOCAL_PARTS.has(localPart)) {
    return true;
  }

  if (/^\d+x$/.test(localPart)) {
    return true;
  }

  if (JUNK_DOMAINS.some((junk) => domain === junk || domain.endsWith(`.${junk}`))) {
    return true;
  }

  // Hashed/tracking addresses: long random-looking local parts.
  if (localPart.length > 40 || /^[0-9a-f]{24,}$/.test(localPart)) {
    return true;
  }

  return false;
};

const rootDomain = (host: string) => host.split('.').slice(-2).join('.');

/**
 * Higher is better. Considers mailbox role and whether the domain matches the
 * business's own site (a matching domain is far more likely to be genuine).
 */
export const scoreEmail = (email: string, siteUrl?: string): number => {
  const [localPart, domain] = email.toLowerCase().split('@');
  let score = 0.5;

  const roleMatch = ROLE_SCORES.find(([pattern]) => pattern.test(localPart));

  if (roleMatch) {
    score = roleMatch[1];
  } else if (/^[a-z]+([._-][a-z]+)?$/.test(localPart)) {
    // Looks like a person's name — usually the best possible outcome.
    score = 0.9;
  }

  if (siteUrl) {
    try {
      const host = new URL(siteUrl).hostname.replace(/^www\./, '');

      if (domain === host || rootDomain(domain) === rootDomain(host)) {
        score += 0.15;
      } else {
        score -= 0.2;
      }
    } catch {
      // Unparseable site URL contributes nothing either way.
    }
  }

  return Math.max(0, Math.min(1, score));
};

export const extractEmails = (text: string): string[] => {
  const matches = text.match(EMAIL_PATTERN) ?? [];
  const cleaned = matches
    .map((match) =>
      match
        .trim()
        .toLowerCase()
        .replace(/[.,;:]+$/, '')
        // Scraped text runs words together ("…apply+info@x.com"), leaving a
        // leading separator that is legal in an address but never intended.
        .replace(/^[+._-]+/, ''),
    )
    .filter((match) => !isJunkEmail(match));

  return [...new Set(cleaned)];
};

export type PickedEmail = {
  email: string;
  confidence: number;
};

export const pickBestEmail = (text: string, siteUrl?: string): PickedEmail | undefined => {
  const candidates = extractEmails(text);

  if (candidates.length === 0) {
    return undefined;
  }

  const ranked = candidates
    .map((email) => ({ email, confidence: scoreEmail(email, siteUrl) }))
    .sort((a, b) => b.confidence - a.confidence);

  return ranked[0];
};
