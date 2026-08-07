import { parse } from 'node-html-parser';
import { normalizeWhitespace, truncate } from '../../shared/text.js';

export type ExtractedSite = {
  title?: string;
  description?: string;
  excerpt: string;
  techSignals: string[];
  hasViewport: boolean;
  hasVideo: boolean;
  copyrightYear?: number;
  internalLinks: string[];
  phone?: string;
  address?: string;
  socialLinks: string[];
};

/**
 * Signals that a site builder was used. For a web-dev pitch these are the
 * strongest openings — the owner already paid for something they outgrew.
 */
const BUILDER_PATTERNS: Array<[RegExp, string]> = [
  [/wix\.com|wixstatic|_wixCssImports/i, 'builder-wix'],
  [/squarespace/i, 'builder-squarespace'],
  [/godaddy|websitebuilder\.godaddy/i, 'builder-godaddy'],
  [/weebly/i, 'builder-weebly'],
  [/shopify/i, 'platform-shopify'],
  [/wp-content|wp-includes|wordpress/i, 'platform-wordpress'],
  [/webflow/i, 'platform-webflow'],
];

const currentYear = () => new Date().getUTCFullYear();

/**
 * Businesses that markup schema.org LocalBusiness/Organization data give
 * phone, address and social links as clean structured fields — reused by
 * Google for their own listings, so far more reliable than pattern-matching
 * the visible page text.
 */
type LdBusiness = {
  telephone?: string;
  address?: string | { streetAddress?: string; addressLocality?: string; postalCode?: string };
  sameAs?: string | string[];
};

const BUSINESS_TYPES = /business|organization|restaurant|store|shop|localbusiness/i;

const flattenJsonLd = (node: unknown): LdBusiness[] => {
  if (Array.isArray(node)) {
    return node.flatMap(flattenJsonLd);
  }

  if (!node || typeof node !== 'object') {
    return [];
  }

  const obj = node as Record<string, unknown>;
  const results: LdBusiness[] = [];

  const type = obj['@type'];
  const typeString = Array.isArray(type) ? type.join(' ') : String(type ?? '');

  if (BUSINESS_TYPES.test(typeString)) {
    results.push(obj as LdBusiness);
  }

  // @graph is how multiple entities are commonly bundled in one script block.
  if (Array.isArray(obj['@graph'])) {
    results.push(...flattenJsonLd(obj['@graph']));
  }

  return results;
};

const formatLdAddress = (address: LdBusiness['address']): string | undefined => {
  if (!address) {
    return undefined;
  }

  if (typeof address === 'string') {
    return address.trim() || undefined;
  }

  const parts = [address.streetAddress, address.addressLocality, address.postalCode]
    .map((part) => part?.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts.join(', ') : undefined;
};

const LD_JSON_SCRIPT = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Reads straight from the raw HTML rather than the parsed DOM. This file
 * parses with blockTextElements script:false so raw JS never leaks into the
 * page excerpt used for AI personalisation — a side effect of that is
 * script.textContent comes back empty, which would silently break this.
 */
const extractJsonLd = (html: string): { phone?: string; address?: string; social: string[] } => {
  const businesses: LdBusiness[] = [];

  for (const match of html.matchAll(LD_JSON_SCRIPT)) {
    try {
      businesses.push(...flattenJsonLd(JSON.parse(match[1])));
    } catch {
      continue;
    }
  }

  const withPhone = businesses.find((b) => b.telephone);
  const withAddress = businesses.find((b) => b.address);
  const social = businesses.flatMap((b) => (Array.isArray(b.sameAs) ? b.sameAs : b.sameAs ? [b.sameAs] : []));

  return {
    phone: withPhone?.telephone?.trim(),
    address: formatLdAddress(withAddress?.address),
    social,
  };
};

/** UK-shaped fallback when the site has no structured data: a tel: link first, then plain text. */
const extractPhoneFallback = (root: ReturnType<typeof parse>, bodyText: string): string | undefined => {
  const telLink = root
    .querySelectorAll('a[href^="tel:"]')
    .map((a) => a.getAttribute('href')?.replace(/^tel:/, '').trim())
    .find(Boolean);

  if (telLink) {
    return telLink;
  }

  const match = bodyText.match(/(?:\+44\s?|0)(?:\d[\s-]?){9,10}\d/);
  return match?.[0]?.trim();
};

const SOCIAL_DOMAINS: Array<[RegExp, string]> = [
  [/(?:www\.)?facebook\.com\/(?!sharer|share)[^/"'?#\s]+/i, 'facebook'],
  [/(?:www\.)?instagram\.com\/[^/"'?#\s]+/i, 'instagram'],
  [/(?:www\.)?linkedin\.com\/(?:company|in)\/[^/"'?#\s]+/i, 'linkedin'],
  [/(?:www\.)?(?:twitter|x)\.com\/[^/"'?#\s]+/i, 'twitter'],
  [/(?:www\.)?tiktok\.com\/@[^/"'?#\s]+/i, 'tiktok'],
];

const extractSocialLinks = (root: ReturnType<typeof parse>, ldSocial: string[]): string[] => {
  const fromAnchors = root
    .querySelectorAll('a[href]')
    .map((a) => a.getAttribute('href') ?? '')
    .filter((href) => SOCIAL_DOMAINS.some(([pattern]) => pattern.test(href)));

  const seenPlatforms = new Set<string>();
  const links: string[] = [];

  for (const href of [...ldSocial, ...fromAnchors]) {
    const platform = SOCIAL_DOMAINS.find(([pattern]) => pattern.test(href))?.[1];

    if (platform && !seenPlatforms.has(platform)) {
      seenPlatforms.add(platform);
      links.push(href.startsWith('http') ? href : `https://${href.replace(/^\/\//, '')}`);
    }
  }

  return links;
};

const extractCopyrightYear = (text: string): number | undefined => {
  const matches = [...text.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–—]\s*)?(\d{4})/gi)];

  if (matches.length === 0) {
    return undefined;
  }

  const years = matches
    .map((match) => Number.parseInt(match[1], 10))
    .filter((year) => year >= 1995 && year <= currentYear() + 1);

  return years.length > 0 ? Math.max(...years) : undefined;
};

export const extractSiteContext = (html: string, pageUrl: string): ExtractedSite => {
  const root = parse(html, { blockTextElements: { script: false, style: false } });
  const techSignals: string[] = [];

  const title = root.querySelector('title')?.textContent?.trim();
  const description = root
    .querySelector('meta[name="description"]')
    ?.getAttribute('content')
    ?.trim();

  const hasViewport = Boolean(root.querySelector('meta[name="viewport"]'));

  if (!hasViewport) {
    techSignals.push('not-mobile-responsive');
  }

  if (!description) {
    techSignals.push('no-meta-description');
  }

  let isHttps = false;

  try {
    isHttps = new URL(pageUrl).protocol === 'https:';
  } catch {
    isHttps = false;
  }

  if (!isHttps) {
    techSignals.push('no-https');
  }

  for (const [pattern, signal] of BUILDER_PATTERNS) {
    if (pattern.test(html)) {
      techSignals.push(signal);
    }
  }

  if (/\bjquery[\w.-]*\.js/i.test(html)) {
    techSignals.push('legacy-jquery');
  }

  // A layout table (not a data table) is a strong sign of a very old build.
  if (root.querySelectorAll('table[width], table[cellpadding], table[border]').length > 0) {
    techSignals.push('table-layout');
  }

  if (/\.swf\b|application\/x-shockwave-flash/i.test(html)) {
    techSignals.push('flash-content');
  }

  const hasVideo =
    root.querySelectorAll('video').length > 0 ||
    /youtube\.com\/embed|player\.vimeo\.com|wistia|loom\.com\/embed/i.test(html);

  techSignals.push(hasVideo ? 'has-video' : 'no-video');

  const bodyText = normalizeWhitespace(root.querySelector('body')?.textContent ?? root.textContent);

  if (bodyText.length < 500) {
    techSignals.push('thin-content');
  }

  const copyrightYear = extractCopyrightYear(html);

  if (copyrightYear !== undefined && currentYear() - copyrightYear >= 2) {
    techSignals.push(`stale-copyright-${copyrightYear}`);
  }

  const internalLinks = [
    ...new Set(
      root
        .querySelectorAll('a[href]')
        .map((anchor) => anchor.getAttribute('href') ?? '')
        .filter((href) => /contact|about|team|get-in-touch|reach-us/i.test(href)),
    ),
  ].slice(0, 8);

  const jsonLd = extractJsonLd(html);
  const phone = jsonLd.phone ?? extractPhoneFallback(root, bodyText);
  const socialLinks = extractSocialLinks(root, jsonLd.social).slice(0, 5);

  return {
    title: title ? truncate(title, 300) : undefined,
    description: description ? truncate(description, 500) : undefined,
    excerpt: truncate(bodyText, 3000),
    techSignals: [...new Set(techSignals)],
    hasViewport,
    hasVideo,
    copyrightYear,
    internalLinks,
    phone,
    address: jsonLd.address,
    socialLinks,
  };
};
