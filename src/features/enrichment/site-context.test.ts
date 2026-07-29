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
