import { describe, expect, it } from 'vitest';
import { extractWebsiteUrl } from './wwr.source.js';

describe('extractWebsiteUrl', () => {
  it('prefers the labelled URL field WeWorkRemotely emits', () => {
    const description =
      '<p>Headquarters: Mexico City<br>URL: http://regexseo.com<br>Description Join our remote team</p>';

    expect(extractWebsiteUrl(description)).toBe('http://regexseo.com');
  });

  it('falls back to the first link when there is no URL label', () => {
    expect(extractWebsiteUrl('<p>See https://gorinsystems.com for details</p>')).toBe(
      'https://gorinsystems.com',
    );
  });

  it('ignores links back to the job board itself', () => {
    expect(
      extractWebsiteUrl('<p>Apply at https://weworkremotely.com/remote-jobs/abc</p>'),
    ).toBeUndefined();
  });

  it('strips trailing punctuation', () => {
    expect(extractWebsiteUrl('<p>Visit https://example.com.</p>')).toBe('https://example.com');
  });

  it('returns undefined when there is no link at all', () => {
    expect(extractWebsiteUrl('<p>No website mentioned here</p>')).toBeUndefined();
  });
});
