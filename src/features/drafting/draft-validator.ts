export type DraftInput = {
  subject: string;
  body: string;
};

export type DraftIssue = {
  code: string;
  message: string;
  severity: 'error' | 'warning';
};

const PLACEHOLDER_PATTERNS: Array<[RegExp, string]> = [
  [/\[[A-Z_ ]{2,30}\]/, 'square-bracket placeholder'],
  [/\{\{[^}]{1,40}\}\}/, 'mustache placeholder'],
  [/\bTODO\b|\bFIXME\b|\bXXX\b/i, 'TODO marker'],
  [/\bYOUR[_ ](NAME|COMPANY|EMAIL)\b/i, 'unfilled template field'],
  [/\binsert [a-z ]{3,20}\b/i, 'insert-instruction left in'],
];

/** Text that reveals the message was machine-generated or is dishonest. */
const AI_LEAK_PATTERNS: Array<[RegExp, string]> = [
  [/\bas an ai\b/i, 'model self-reference'],
  [/\bas a language model\b/i, 'model self-reference'],
  [/\bi (?:cannot|can't) browse\b/i, 'model self-reference'],
  [/\bhere(?:'s| is) (?:the|your) (?:draft|email)\b/i, 'model preamble'],
  [/```/, 'markdown code fence'],
];

const DISHONEST_PATTERNS: Array<[RegExp, string]> = [
  [/\bi (?:have )?(?:been )?(?:a )?(?:long[- ]time )?(?:customer|client) of\b/i, 'false customer claim'],
  [/\bwe (?:spoke|met|chatted) (?:last|earlier|previously|before)\b/i, 'false prior-contact claim'],
  [/\bas (?:we )?discussed\b/i, 'false prior-contact claim'],
  [/\bper our (?:call|conversation|chat)\b/i, 'false prior-contact claim'],
  [/\bfollowing up on (?:our|your) (?:call|meeting)\b/i, 'false prior-contact claim'],
];

const BANNED_SUBJECT_PREFIXES = /^\s*(re|fw|fwd)\s*:/i;

const MIN_BODY_WORDS = 40;
const MAX_BODY_WORDS = 260;
const MAX_SUBJECT_LENGTH = 90;

/** Subjects that carry no information about the specific recipient. */
const GENERIC_SUBJECTS = new Set([
  'website update',
  'website',
  'your website',
  'website redesign',
  'web design',
  'quick question',
  'a quick question',
  'question',
  'hello',
  'hi',
  'hi there',
  'introduction',
  'intro',
  'opportunity',
  'business opportunity',
  'proposal',
  'collaboration',
  'partnership',
  'checking in',
  'following up',
  'web development',
  'video editing',
  'your site',
  'new website',
]);

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Deterministic gate applied AFTER the model returns. The model cannot argue with
 * these, so a bad draft can never reach the approval queue — let alone an inbox.
 */
export const validateDraft = (draft: DraftInput): DraftIssue[] => {
  const issues: DraftIssue[] = [];
  const subject = draft.subject.trim();
  const body = draft.body.trim();

  if (subject.length < 3) {
    issues.push({ code: 'SUBJECT_TOO_SHORT', message: 'Subject is empty or too short', severity: 'error' });
  }

  if (subject.length > MAX_SUBJECT_LENGTH) {
    issues.push({
      code: 'SUBJECT_TOO_LONG',
      message: `Subject is ${subject.length} characters (max ${MAX_SUBJECT_LENGTH})`,
      severity: 'error',
    });
  }

  // A subject that would fit any recipient is the clearest tell of a mass mailout,
  // and the model reaches for these unless it is stopped.
  if (GENERIC_SUBJECTS.has(subject.toLowerCase().replace(/[.!?]+$/, ''))) {
    issues.push({
      code: 'SUBJECT_TOO_GENERIC',
      message: `Subject "${subject}" could be sent to anyone; it must name the business or a specific detail`,
      severity: 'error',
    });
  }

  // Faking a reply thread is deceptive and violates CAN-SPAM's honest-subject rule.
  if (BANNED_SUBJECT_PREFIXES.test(subject)) {
    issues.push({
      code: 'SUBJECT_FAKE_REPLY',
      message: 'Subject pretends to be a reply or forward',
      severity: 'error',
    });
  }

  const words = countWords(body);

  if (words < MIN_BODY_WORDS) {
    issues.push({
      code: 'BODY_TOO_SHORT',
      message: `Body is ${words} words (min ${MIN_BODY_WORDS})`,
      severity: 'error',
    });
  }

  if (words > MAX_BODY_WORDS) {
    issues.push({
      code: 'BODY_TOO_LONG',
      message: `Body is ${words} words (max ${MAX_BODY_WORDS})`,
      severity: 'error',
    });
  }

  for (const [pattern, label] of PLACEHOLDER_PATTERNS) {
    if (pattern.test(body) || pattern.test(subject)) {
      issues.push({
        code: 'PLACEHOLDER_LEFT',
        message: `Draft still contains a ${label}`,
        severity: 'error',
      });
      break;
    }
  }

  for (const [pattern, label] of AI_LEAK_PATTERNS) {
    if (pattern.test(body) || pattern.test(subject)) {
      issues.push({ code: 'AI_LEAK', message: `Draft contains a ${label}`, severity: 'error' });
      break;
    }
  }

  for (const [pattern, label] of DISHONEST_PATTERNS) {
    if (pattern.test(body)) {
      issues.push({ code: 'DISHONEST_CLAIM', message: `Draft contains a ${label}`, severity: 'error' });
      break;
    }
  }

  // The footer is appended server-side; a model-written one would duplicate it.
  if (/\bunsubscribe\b/i.test(body)) {
    issues.push({
      code: 'DUPLICATE_UNSUBSCRIBE',
      message: 'Body writes its own unsubscribe line; one is appended automatically',
      severity: 'warning',
    });
  }

  if (/<[a-z][^>]*>/i.test(body)) {
    issues.push({ code: 'HTML_IN_BODY', message: 'Body contains HTML tags', severity: 'warning' });
  }

  if (!body.includes('?')) {
    issues.push({
      code: 'NO_QUESTION',
      message: 'Body does not ask a question, so there is nothing easy to reply to',
      severity: 'warning',
    });
  }

  return issues;
};

export const hasBlockingIssue = (issues: DraftIssue[]): boolean =>
  issues.some((issue) => issue.severity === 'error');
