import type { AiProvider, ChatRequest } from './ai.types.js';

/**
 * Deterministic provider used by AI_DRY_RUN. Produces schema-valid output
 * derived from the prompt so the whole pipeline can run with no API key and no
 * network, and so tests are repeatable.
 */
export const TASK_MARKERS = {
  qualification: 'TASK:QUALIFICATION',
  draft: 'TASK:OUTREACH_DRAFT',
} as const;

const hashScore = (input: string) => {
  let hash = 0;

  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % 1000;
  }

  return 55 + (hash % 41); // 55..95, always above a typical draft threshold
};

const firstLine = (text: string, marker: string) => {
  const match = text.match(new RegExp(`${marker}:\\s*(.+)`, 'i'));
  return match ? match[1].trim() : undefined;
};

const qualificationResponse = (user: string) => {
  const score = hashScore(user);
  const business = firstLine(user, 'Business') ?? 'this business';
  const signals = firstLine(user, 'Site signals') ?? '';

  const reasons = [`Matches the target profile for ${business}`];
  const hooks: string[] = [];

  if (signals.includes('not-mobile-responsive')) {
    reasons.push('Site is not mobile responsive');
    hooks.push('their site does not adapt to phones');
  }

  if (signals.includes('stale-copyright')) {
    reasons.push('Site looks unmaintained');
    hooks.push('the footer still shows an old copyright year');
  }

  if (signals.includes('no-video')) {
    hooks.push('there is no video anywhere on the site');
  }

  if (hooks.length === 0) {
    hooks.push('they described the work they need in their own post');
  }

  return JSON.stringify({
    score,
    tier: score >= 80 ? 'hot' : score >= 60 ? 'warm' : 'cold',
    reasons: reasons.slice(0, 5),
    personalizationHooks: hooks.slice(0, 4),
    serviceFit: signals.includes('no-video') ? ['web development', 'video editing'] : ['web development'],
    recommendation: score >= 50 ? 'contact' : 'skip',
  });
};

const draftResponse = (user: string) => {
  const business = firstLine(user, 'Business') ?? 'there';
  const hook = (firstLine(user, 'Hooks') ?? 'your recent post').split('|')[0].trim();

  return JSON.stringify({
    subject: `Quick question about ${business}`,
    body: [
      `Hi,`,
      ``,
      `I came across ${business} and noticed ${hook}.`,
      ``,
      `I build and rebuild websites for small teams, and I also edit short-form video. If it would help, I am happy to send over a couple of specific suggestions with no obligation.`,
      ``,
      `Would that be useful?`,
      ``,
      `Best,`,
    ].join('\n'),
    hookUsed: hook,
  });
};

export const stubProvider: AiProvider = {
  name: 'stub',
  model: 'stub-deterministic',

  async chat(request: ChatRequest) {
    const text = request.system.includes(TASK_MARKERS.draft)
      ? draftResponse(request.user)
      : qualificationResponse(request.user);

    return { text, model: 'stub-deterministic' };
  },
};
