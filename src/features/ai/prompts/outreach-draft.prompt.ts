import { truncate } from '../../../shared/text.js';
import type { CampaignDocument } from '../../campaigns/campaign.model.js';
import type { LeadDocument } from '../../leads/lead.model.js';
import type { MessageKind } from '../../outreach/outreach-message.model.js';
import { TASK_MARKERS } from '../stub.provider.js';

export const draftSystemPrompt = `${TASK_MARKERS.draft}
You write short, plain, honest cold outreach emails for a freelancer.

Hard rules:
- Open with a greeting on its own line: "Hi," or "Hi <first name>," if a name is
  known. Never open with your own name.
- 90 to 150 words in the body. Shorter is better.
- Plain text. No markdown, no bullet lists, no emoji, no images.
- Reference ONE concrete detail about the recipient, taken only from the supplied
  context. Never invent facts, numbers, praise, mutual contacts, or past interactions.
- Never claim to have used their product, visited their premises, or spoken to them before.
- No hype, no flattery, no "I hope this email finds you well", no "I noticed you're crushing it".
- The subject must be lowercase-ish, specific and under 60 characters. Never start
  it with "Re:" or "Fwd:" - that is deceptive.
- The subject MUST name the business or the specific detail you are writing about.
  Generic subjects are rejected automatically. Bad: "website update", "quick question",
  "your website", "hello". Good: "Khandoker's curry club page", "the Y Club booking form
  on mobile", "Armenian Taverna site on phones".
- One clear, low-friction question at the end. Do not demand a call.
- Do NOT write a signature, sign-off block, unsubscribe line, or postal address.
  Those are appended automatically. End after the closing question, or with a
  single short sign-off word.
- Do not use placeholder tokens like [NAME], {{company}} or TODO. If you do not
  know something, leave it out entirely.

Respond with JSON only, matching exactly:
{"subject":"...","body":"...","hookUsed":"..."}`;

const followUpGuidance: Record<MessageKind, string> = {
  initial: 'This is the first email. Introduce yourself in one short sentence.',
  followup_1:
    'This is a follow-up to an earlier email that got no reply. Keep it to 2-3 sentences, reference the original topic briefly, add one new useful thought, and make it easy to say no.',
  followup_2:
    'This is the final follow-up. Two sentences maximum. Politely close the loop and make clear you will not chase again.',
};

export const buildDraftUserPrompt = (
  lead: LeadDocument,
  campaign: CampaignDocument,
  kind: MessageKind,
  previousBody?: string,
): string => {
  const lines: string[] = [
    `Sender name: ${campaign.sender.name}`,
    `Sender offer: ${truncate(campaign.offer || 'freelance web development and video editing', 500)}`,
    `Services: ${campaign.services.join(', ') || 'web development, video editing'}`,
    '',
    `Business: ${lead.company ?? lead.name}`,
    `Email kind: ${kind}`,
    followUpGuidance[kind],
  ];

  if (lead.intent) {
    lines.push(
      '',
      `They posted: ${lead.intent.title}`,
      `Post body: ${truncate(lead.intent.excerpt, 900)}`,
    );
  }

  if (lead.site) {
    lines.push(
      '',
      `Their site: ${lead.site.title ?? lead.websiteUrl ?? 'unknown'}`,
      `Site problems detected: ${lead.site.techSignals.join(', ') || 'none'}`,
      `Site excerpt: ${truncate(lead.site.excerpt ?? '', 700)}`,
    );
  }

  const hooks = lead.ai?.personalizationHooks ?? [];

  if (hooks.length > 0) {
    lines.push('', `Hooks: ${hooks.join(' | ')}`);
  }

  if (lead.ai?.serviceFit?.length) {
    lines.push(`Best-fit service: ${lead.ai.serviceFit.join(', ')}`);
  }

  if (previousBody) {
    lines.push('', `Previous email you sent them:\n${truncate(previousBody, 700)}`);
  }

  return lines.join('\n');
};
