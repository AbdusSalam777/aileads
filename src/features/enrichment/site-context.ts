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

  return {
    title: title ? truncate(title, 300) : undefined,
    description: description ? truncate(description, 500) : undefined,
    excerpt: truncate(bodyText, 3000),
    techSignals: [...new Set(techSignals)],
    hasViewport,
    hasVideo,
    copyrightYear,
    internalLinks,
  };
};
