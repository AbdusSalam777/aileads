import { describe, expect, it } from 'vitest';
import { scoreIntent } from './intent-score.js';

const now = new Date('2026-07-28T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe('scoreIntent', () => {
  it('scores a fresh, budgeted web-dev hiring post highly', () => {
    const result = scoreIntent({
      title: 'Looking for a React developer to build a landing page',
      excerpt: 'We need a web developer for an ongoing project. Budget around $4,000.',
      postedAt: hoursAgo(2),
      now,
    });

    expect(result.disqualified).toBe(false);
    expect(result.score).toBeGreaterThan(70);
    expect(result.serviceFit).toContain('web development');
  });

  it('recognises video editing work', () => {
    const result = scoreIntent({
      title: 'Need a video editor for YouTube shorts',
      excerpt: 'Premiere Pro and after effects, long term retainer.',
      postedAt: hoursAgo(3),
      now,
    });

    expect(result.serviceFit).toContain('video editing');
    expect(result.score).toBeGreaterThan(60);
  });

  it('decays score with age so stale posts lose the race', () => {
    const base = {
      title: 'Hiring a web developer',
      excerpt: 'Need a website built with React.',
      now,
    };

    const fresh = scoreIntent({ ...base, postedAt: hoursAgo(1) }).score;
    const day = scoreIntent({ ...base, postedAt: hoursAgo(20) }).score;
    const week = scoreIntent({ ...base, postedAt: hoursAgo(140) }).score;
    const ancient = scoreIntent({ ...base, postedAt: hoursAgo(400) }).score;

    expect(fresh).toBeGreaterThan(day);
    expect(day).toBeGreaterThan(week);
    expect(week).toBeGreaterThan(ancient);
  });

  it('disqualifies unpaid, equity-only and exposure work', () => {
    for (const excerpt of [
      'This is an unpaid internship building a website',
      'Equity only, looking for a full stack developer',
      'Video editing for exposure, great portfolio piece',
      'Commission only web development role',
    ]) {
      const result = scoreIntent({ title: 'Opportunity', excerpt, postedAt: hoursAgo(1), now });
      expect(result.disqualified).toBe(true);
      expect(result.score).toBe(0);
    }
  });

  it('disqualifies people advertising their own availability', () => {
    const result = scoreIntent({
      title: '[FOR HIRE] Senior React developer seeking work',
      excerpt: 'I am available for hire, 10 years of web development experience.',
      postedAt: hoursAgo(1),
      now,
    });

    expect(result.disqualified).toBe(true);
  });

  it('disqualifies posts with no matching service', () => {
    const result = scoreIntent({
      title: 'Hiring a warehouse forklift operator',
      excerpt: 'Full time position, competitive salary.',
      postedAt: hoursAgo(1),
      now,
    });

    expect(result.disqualified).toBe(true);
    expect(result.serviceFit).toHaveLength(0);
  });

  it('penalises insultingly low budgets', () => {
    const low = scoreIntent({
      title: 'Need a website',
      excerpt: 'Build me a full web app for $30.',
      postedAt: hoursAgo(1),
      now,
    });

    const healthy = scoreIntent({
      title: 'Need a website',
      excerpt: 'Build me a full web app, budget $5,000.',
      postedAt: hoursAgo(1),
      now,
    });

    expect(healthy.score).toBeGreaterThan(low.score);
    expect(low.signals.join(' ')).toContain('too low');
  });

  it('parses k-suffixed budgets', () => {
    const result = scoreIntent({
      title: 'Hiring web developer',
      excerpt: 'Budget is $5k for the website build.',
      postedAt: hoursAgo(1),
      now,
    });

    expect(result.signals.join(' ')).toContain('healthy budget');
  });

  it('rewards campaign keyword matches', () => {
    const without = scoreIntent({
      title: 'Need a web developer',
      excerpt: 'Store rebuild project.',
      postedAt: hoursAgo(1),
      now,
    });

    const with_ = scoreIntent({
      title: 'Need a web developer',
      excerpt: 'Shopify store rebuild project.',
      postedAt: hoursAgo(1),
      now,
      keywords: ['shopify'],
    });

    expect(with_.score).toBeGreaterThan(without.score);
  });

  it('never returns a score outside 0-100', () => {
    const result = scoreIntent({
      title: 'Hiring a full stack web developer react node typescript nextjs webflow shopify',
      excerpt:
        'Looking to hire a video editor, premiere pro, after effects, motion graphics, long term retainer, budget $50,000',
      postedAt: hoursAgo(0),
      now,
      keywords: ['react', 'shopify', 'video'],
    });

    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('treats missing postedAt as a mild unknown rather than a disqualifier', () => {
    const result = scoreIntent({
      title: 'Hiring a web developer',
      excerpt: 'React project.',
      now,
    });

    expect(result.disqualified).toBe(false);
    expect(result.signals).toContain('unknown age');
  });
});

describe('employment vs project work', () => {
  const now = new Date('2026-07-28T12:00:00Z');

  it('disqualifies a salaried job posting that otherwise matches the services', () => {
    // Modelled on a real WeWorkRemotely result that previously scored well.
    const result = scoreIntent({
      title: 'Director, Product Design (Remote Eligible)',
      excerpt:
        'Join our team building web apps with react and typescript. Full-time role with salary, ' +
        'benefits package, 401k and paid time off. We are an equal opportunity employer.',
      postedAt: new Date('2026-07-28T11:00:00Z'),
      now,
    });

    expect(result.disqualified).toBe(true);
    expect(result.score).toBe(0);
    expect(result.signals.join(' ')).toMatch(/full-time job posting/i);
  });

  it('keeps a freelance post even when it mentions employment-ish words', () => {
    const result = scoreIntent({
      title: 'Need a freelance web developer for a landing page',
      excerpt:
        'Looking for a freelancer on a project basis. Full-time employees are not what we want here. Budget $3,000.',
      postedAt: new Date('2026-07-28T11:00:00Z'),
      now,
    });

    expect(result.disqualified).toBe(false);
    expect(result.signals.join(' ')).toMatch(/project work/i);
  });

  it('scores a freelance post above an otherwise identical one without project wording', () => {
    const base = {
      title: 'Need a web developer for a landing page',
      excerpt: 'React and next.js work. Budget $3,000.',
      postedAt: new Date('2026-07-28T11:00:00Z'),
      now,
    };

    const freelance = scoreIntent({ ...base, excerpt: `${base.excerpt} Freelance contract basis.` });
    const plain = scoreIntent(base);

    expect(freelance.score).toBeGreaterThan(plain.score);
  });
});
