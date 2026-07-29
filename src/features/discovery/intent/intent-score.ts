export type IntentScoreInput = {
  title: string;
  excerpt: string;
  tags?: string[];
  budgetText?: string;
  postedAt?: Date;
  now?: Date;
  /** Extra match terms from the campaign, e.g. ['shopify', 'webflow']. */
  keywords?: string[];
};

export type IntentScoreResult = {
  score: number;
  signals: string[];
  /** Which of the operator's services this post appears to want. */
  serviceFit: string[];
  disqualified: boolean;
};

const WEB_TERMS = [
  'web developer',
  'web development',
  'website',
  'web design',
  'frontend',
  'front-end',
  'backend',
  'back-end',
  'full stack',
  'fullstack',
  'react',
  'next.js',
  'nextjs',
  'node.js',
  'nodejs',
  'typescript',
  'javascript',
  'landing page',
  'wordpress',
  'shopify',
  'webflow',
  'web app',
  'saas',
  'api integration',
];

const VIDEO_TERMS = [
  'video editor',
  'video editing',
  'video edit',
  'premiere pro',
  'after effects',
  'davinci resolve',
  'final cut',
  'motion graphics',
  'youtube editor',
  'reels',
  'shorts editor',
  'podcast editing',
  'colour grading',
  'color grading',
];

const HIRING_TERMS = [
  'seeking freelancer',
  'looking for a',
  'looking to hire',
  'we are hiring',
  "we're hiring",
  'hiring',
  'need a',
  'need someone',
  'need help with',
  'in need of',
  'contract role',
  'freelancer wanted',
  'developer wanted',
  'seeking a',
];

const COMMITMENT_TERMS = ['long term', 'long-term', 'ongoing', 'retainer', 'monthly', 'part time', 'part-time'];

/** Hard disqualifiers — these are never worth an outreach slot. */
const RED_FLAGS = [
  'unpaid',
  'no pay',
  'volunteer',
  'equity only',
  'equity-only',
  'for exposure',
  'commission only',
  'commission-only',
  'profit share only',
  'revenue share only',
];

const SEEKING_WORK_MARKERS = ['seeking work', 'looking for work', 'available for hire', '[for hire]'];

/**
 * Salaried-employment markers. Job boards are full of full-time roles, which
 * look superficially like demand — they match the service terms and use hiring
 * language — but nobody there wants to engage a freelancer.
 */
const EMPLOYMENT_MARKERS = [
  'full-time',
  'full time',
  'salary',
  'salaried',
  'benefits package',
  'health insurance',
  'dental',
  'vision insurance',
  '401k',
  '401(k)',
  'paid time off',
  'pto',
  'equal opportunity employer',
  'visa sponsorship',
  'join our team',
  'join us',
  'our mission',
  'career growth',
  'stock options',
  'employee',
  'onboarding process',
  'perks',
];

/** Explicit project-work markers that override the employment heuristic. */
const FREELANCE_MARKERS = [
  'freelance',
  'freelancer',
  'contractor',
  'contract basis',
  'project basis',
  'per project',
  'one-off',
  'one off project',
  'short-term project',
  'ad hoc',
  'agency',
  'consultant',
  'seeking freelancer',
  'hire a freelancer',
];

const countMatches = (haystack: string, terms: readonly string[]) =>
  terms.filter((term) => haystack.includes(term));

const parseLowestAmount = (text: string): number | undefined => {
  const matches = [...text.matchAll(/\$\s?(\d[\d,]*)(k\b)?/gi)];

  if (matches.length === 0) {
    return undefined;
  }

  const amounts = matches.map((match) => {
    const base = Number.parseInt(match[1].replace(/,/g, ''), 10);
    return match[2] ? base * 1000 : base;
  });

  return Math.min(...amounts);
};

const recencyPoints = (postedAt: Date | undefined, now: Date): { points: number; label: string } => {
  if (!postedAt) {
    return { points: 4, label: 'unknown age' };
  }

  const hours = (now.getTime() - postedAt.getTime()) / 3_600_000;

  if (hours < 0) return { points: 26, label: 'posted just now' };
  if (hours <= 6) return { points: 26, label: 'posted <6h ago' };
  if (hours <= 24) return { points: 20, label: 'posted <24h ago' };
  if (hours <= 72) return { points: 12, label: 'posted <72h ago' };
  if (hours <= 168) return { points: 5, label: 'posted <7d ago' };
  return { points: 0, label: 'posted >7d ago' };
};

/**
 * Scores how strongly a post signals someone actively wants to pay for the
 * operator's services. Intent leads are a race, so recency is weighted heavily.
 */
export const scoreIntent = (input: IntentScoreInput): IntentScoreResult => {
  const now = input.now ?? new Date();
  const haystack = [input.title, input.excerpt, (input.tags ?? []).join(' '), input.budgetText ?? '']
    .join(' ')
    .toLowerCase();

  const signals: string[] = [];
  const serviceFit: string[] = [];
  let score = 0;

  const redFlags = countMatches(haystack, RED_FLAGS);

  if (redFlags.length > 0) {
    return {
      score: 0,
      signals: [`red flag: ${redFlags.join(', ')}`],
      serviceFit: [],
      disqualified: true,
    };
  }

  // Someone advertising their own availability is a competitor, not a client.
  if (SEEKING_WORK_MARKERS.some((marker) => haystack.includes(marker))) {
    return {
      score: 0,
      signals: ['post is someone offering work, not hiring'],
      serviceFit: [],
      disqualified: true,
    };
  }

  // Salaried job ads dominate the remote boards and match every service term,
  // so they must be filtered before scoring or they crowd out real demand.
  const freelanceMatches = countMatches(haystack, FREELANCE_MARKERS);
  const employmentMatches = countMatches(haystack, EMPLOYMENT_MARKERS);

  if (freelanceMatches.length === 0 && employmentMatches.length >= 2) {
    return {
      score: 0,
      signals: [`full-time job posting, not project work: ${employmentMatches.slice(0, 3).join(', ')}`],
      serviceFit: [],
      disqualified: true,
    };
  }

  const recency = recencyPoints(input.postedAt, now);
  score += recency.points;
  signals.push(recency.label);

  const webMatches = countMatches(haystack, WEB_TERMS);
  const videoMatches = countMatches(haystack, VIDEO_TERMS);

  if (webMatches.length > 0) {
    serviceFit.push('web development');
    score += Math.min(22, 12 + webMatches.length * 3);
    signals.push(`web terms: ${webMatches.slice(0, 3).join(', ')}`);
  }

  if (videoMatches.length > 0) {
    serviceFit.push('video editing');
    score += Math.min(22, 12 + videoMatches.length * 3);
    signals.push(`video terms: ${videoMatches.slice(0, 3).join(', ')}`);
  }

  if (serviceFit.length === 0) {
    return {
      score: 0,
      signals: ['no matching service terms'],
      serviceFit: [],
      disqualified: true,
    };
  }

  const hiringMatches = countMatches(haystack, HIRING_TERMS);

  if (hiringMatches.length > 0) {
    score += 16;
    signals.push(`hiring language: ${hiringMatches[0]}`);
  }

  if (freelanceMatches.length > 0) {
    score += 14;
    signals.push(`project work: ${freelanceMatches.slice(0, 2).join(', ')}`);
  }

  const keywordMatches = countMatches(haystack, (input.keywords ?? []).map((k) => k.toLowerCase()));

  if (keywordMatches.length > 0) {
    score += Math.min(12, keywordMatches.length * 4);
    signals.push(`campaign keywords: ${keywordMatches.slice(0, 3).join(', ')}`);
  }

  const lowestAmount = parseLowestAmount(haystack);

  if (input.budgetText || lowestAmount !== undefined) {
    score += 10;
    signals.push('budget mentioned');

    if (lowestAmount !== undefined && lowestAmount < 100) {
      score -= 25;
      signals.push(`budget looks too low ($${lowestAmount})`);
    } else if (lowestAmount !== undefined && lowestAmount >= 1000) {
      score += 8;
      signals.push(`healthy budget ($${lowestAmount}+)`);
    }
  }

  if (countMatches(haystack, COMMITMENT_TERMS).length > 0) {
    score += 8;
    signals.push('ongoing/long-term work');
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));

  return { score: clamped, signals, serviceFit, disqualified: clamped === 0 };
};
