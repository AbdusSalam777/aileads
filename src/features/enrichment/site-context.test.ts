import { describe, expect, it } from 'vitest';
import { extractSiteContext } from './site-context.js';

const wrap = (head: string, body: string) =>
  `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

describe('extractSiteContext', () => {
  it('flags a site that is not mobile responsive', () => {
    const result = extractSiteContext(wrap('<title>Shop</title>', '<p>Hello</p>'), 'https://a.com');

    expect(result.hasViewport).toBe(false);
    expect(result.techSignals).toContain('not-mobile-responsive');
  });

  it('does not flag a responsive site', () => {
    const html = wrap('<meta name="viewport" content="width=device-width">', '<p>Hi</p>');
    const result = extractSiteContext(html, 'https://a.com');

    expect(result.hasViewport).toBe(true);
    expect(result.techSignals).not.toContain('not-mobile-responsive');
  });

  it('flags plain http as no-https', () => {
    expect(extractSiteContext(wrap('', ''), 'http://a.com').techSignals).toContain('no-https');
    expect(extractSiteContext(wrap('', ''), 'https://a.com').techSignals).not.toContain('no-https');
  });

  it('detects site builders and platforms', () => {
    const cases: Array<[string, string]> = [
      ['<script src="https://static.wixstatic.com/x.js"></script>', 'builder-wix'],
      ['<div>powered by Squarespace</div>', 'builder-squarespace'],
      ['<link href="/wp-content/themes/x/style.css">', 'platform-wordpress'],
      ['<script src="https://cdn.shopify.com/s/x.js"></script>', 'platform-shopify'],
    ];

    for (const [markup, signal] of cases) {
      expect(extractSiteContext(wrap('', markup), 'https://a.com').techSignals).toContain(signal);
    }
  });

  it('detects legacy jquery and table layouts', () => {
    const html = wrap(
      '<script src="/js/jquery-1.11.3.min.js"></script>',
      '<table width="960" cellpadding="4"><tr><td>old</td></tr></table>',
    );
    const result = extractSiteContext(html, 'https://a.com');

    expect(result.techSignals).toContain('legacy-jquery');
    expect(result.techSignals).toContain('table-layout');
  });

  it('detects whether the site has any video', () => {
    const withVideo = extractSiteContext(
      wrap('', '<iframe src="https://www.youtube.com/embed/abc"></iframe>'),
      'https://a.com',
    );
    const withoutVideo = extractSiteContext(wrap('', '<p>text only</p>'), 'https://a.com');

    expect(withVideo.hasVideo).toBe(true);
    expect(withVideo.techSignals).toContain('has-video');
    expect(withoutVideo.hasVideo).toBe(false);
    expect(withoutVideo.techSignals).toContain('no-video');
  });

  it('extracts a stale copyright year and flags it', () => {
    const result = extractSiteContext(wrap('', '<p>&copy; 2017 Acme Ltd</p>'), 'https://a.com');

    expect(result.copyrightYear).toBe(2017);
    expect(result.techSignals.some((s) => s.startsWith('stale-copyright-'))).toBe(true);
  });

  it('does not flag a current copyright year', () => {
    const year = new Date().getUTCFullYear();
    const result = extractSiteContext(wrap('', `<p>&copy; ${year} Acme</p>`), 'https://a.com');

    expect(result.techSignals.some((s) => s.startsWith('stale-copyright-'))).toBe(false);
  });

  it('handles copyright ranges by taking the latest year', () => {
    const result = extractSiteContext(wrap('', '<p>&copy; 2010-2019 Acme</p>'), 'https://a.com');
    expect(result.copyrightYear).toBe(2019);
  });

  it('ignores script and style content in the excerpt', () => {
    const html = wrap(
      '<style>.a{color:red}</style>',
      '<script>var secret = "do not include";</script><p>Real content here</p>',
    );
    const result = extractSiteContext(html, 'https://a.com');

    expect(result.excerpt).toContain('Real content here');
    expect(result.excerpt).not.toContain('do not include');
    expect(result.excerpt).not.toContain('color:red');
  });

  it('collects contact-ish internal links', () => {
    const html = wrap(
      '',
      '<a href="/contact">Contact</a><a href="/about-us">About</a><a href="/blog">Blog</a>',
    );
    const result = extractSiteContext(html, 'https://a.com');

    expect(result.internalLinks).toContain('/contact');
    expect(result.internalLinks).toContain('/about-us');
    expect(result.internalLinks).not.toContain('/blog');
  });

  it('flags thin content', () => {
    expect(extractSiteContext(wrap('', '<p>Hi</p>'), 'https://a.com').techSignals).toContain(
      'thin-content',
    );
  });

  it('survives malformed html without throwing', () => {
    expect(() => extractSiteContext('<html><body><p>unclosed', 'https://a.com')).not.toThrow();
    expect(() => extractSiteContext('', 'not a url')).not.toThrow();
  });
});

describe('extractSiteContext — structured business data', () => {
  it('reads phone, address and social links from schema.org JSON-LD', () => {
    const ld = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Restaurant',
      telephone: '+44 161 234 5678',
      address: { streetAddress: '12 High St', addressLocality: 'Manchester', postalCode: 'M1 1AA' },
      sameAs: ['https://www.facebook.com/example', 'https://www.instagram.com/example'],
    });
    const html = wrap(`<script type="application/ld+json">${ld}</script>`, '<p>Welcome</p>');
    const result = extractSiteContext(html, 'https://a.com');

    expect(result.phone).toBe('+44 161 234 5678');
    expect(result.address).toBe('12 High St, Manchester, M1 1AA');
    expect(result.socialLinks).toEqual([
      'https://www.facebook.com/example',
      'https://www.instagram.com/example',
    ]);
  });

  it('finds a business entity nested inside @graph', () => {
    const ld = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'Example' },
        { '@type': 'LocalBusiness', telephone: '0161 999 8888' },
      ],
    });
    const html = wrap(`<script type="application/ld+json">${ld}</script>`, '<p>Hi</p>');

    expect(extractSiteContext(html, 'https://a.com').phone).toBe('0161 999 8888');
  });

  it('ignores JSON-LD that is not business-typed', () => {
    const ld = JSON.stringify({ '@type': 'BreadcrumbList', telephone: 'should-not-appear' });
    const html = wrap(`<script type="application/ld+json">${ld}</script>`, '<p>Hi</p>');

    expect(extractSiteContext(html, 'https://a.com').phone).toBeUndefined();
  });

  it('does not crash on malformed JSON-LD', () => {
    const html = wrap('<script type="application/ld+json">{not valid json</script>', '<p>Hi</p>');

    expect(() => extractSiteContext(html, 'https://a.com')).not.toThrow();
  });

  it('falls back to a tel: link when there is no JSON-LD', () => {
    const html = wrap('', '<a href="tel:+441619998888">Call us</a>');

    expect(extractSiteContext(html, 'https://a.com').phone).toBe('+441619998888');
  });

  it('falls back to a plain-text UK phone number as a last resort', () => {
    const html = wrap('', '<p>Ring us on 0161 999 8888 for bookings.</p>');

    expect(extractSiteContext(html, 'https://a.com').phone).toContain('0161');
  });

  it('extracts social links directly from anchor tags when there is no JSON-LD', () => {
    const html = wrap(
      '',
      '<a href="https://www.linkedin.com/company/example">LinkedIn</a><a href="https://facebook.com/sharer?u=x">Share</a>',
    );
    const result = extractSiteContext(html, 'https://a.com');

    expect(result.socialLinks).toEqual(['https://www.linkedin.com/company/example']);
  });

  it('keeps only one link per platform', () => {
    const html = wrap(
      '',
      '<a href="https://facebook.com/one">A</a><a href="https://facebook.com/two">B</a>',
    );

    expect(extractSiteContext(html, 'https://a.com').socialLinks).toHaveLength(1);
  });

  it('returns undefined phone and an empty social list when the site has neither', () => {
    const result = extractSiteContext(wrap('', '<p>Nothing here.</p>'), 'https://a.com');

    expect(result.phone).toBeUndefined();
    expect(result.socialLinks).toEqual([]);
  });
});
