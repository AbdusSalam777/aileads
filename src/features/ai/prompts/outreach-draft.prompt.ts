import { truncate } from '../../../shared/text.js';
import type { CampaignDocument } from '../../campaigns/campaign.model.js';
import type { LeadDocument } from '../../leads/lead.model.js';
import type { MessageKind } from '../../outreach/outreach-message.model.js';
import { TASK_MARKERS } from '../stub.provider.js';

export const draftSystemPrompt = `${TASK_MARKERS.draft}
You write short, plain, honest cold outreach emails for a freelancer.

The reader owes you nothing and deletes cold email by reflex. The only thing
that earns a reply is proving, in the first line, that you looked at THEIR
business specifically. What you sell is not interesting until then.

Structure the body in exactly this order:

1. Greeting on its own line: "Hi," or "Hi <first name>," if a name is known.
2. FIRST SENTENCE: something specific and factual about THIS business, taken
   from their site content or their post - what they sell, where they are, a
   named dish or service, an offer they run. Anything that could not be said
   about a different business. Never your own services. Never a compliment.
   "Your site lists a Tuesday beginners class alongside the competition squad"
   is right - it is specific to them. "Your business has a rich history" is
   wrong: it says nothing and fits anyone. Do not reuse this example, it is an
   illustration of shape only; take your detail from the supplied context.
   Prefer a real detail from their site content over a technical signal:
   "WordPress and old jQuery" is true of half the web and reads as a template.
3. Connect that to ONE detected site problem, and say what it costs them.
   This is where the technical signal belongs - after you have shown you looked
   at the business itself.
4. ONE short line saying who you are. One line, not a paragraph.
5. A low-friction closing question that asks for something tiny.

Worked example of the right shape:

  Hi,

  Your booking form does not work on a phone - the submit button sits off the
  edge of the screen on an iPhone. Most people looking for a restaurant are on
  their phone, so those bookings are quietly being lost.

  I build and rebuild sites for small businesses, and this is usually a
  half-day fix.

  Want me to send a screenshot of what I mean?

Hard rules:
- 90 to 150 words in the body. Shorter is better.
- Plain text. No markdown, no bullet lists, no emoji, no images.
- The first sentence must be about THEM. Never open with "I build", "I am",
  "I help" or any description of your services. That is the single most common
  failure and it reads as a mass mailout.
- You may ONLY state problems that appear in the "Site problems detected" list.
  You have not seen their site. Describing a defect that was not detected is a
  lie the recipient can check in ten seconds, and it destroys the email.
  Translate each signal using exactly this mapping, and nothing beyond it:
    not-mobile-responsive -> the site does not adapt to phone screens
    no-meta-description   -> the site has no description for search results
    legacy-jquery         -> the site runs on old jQuery code
    platform-wordpress    -> the site runs on WordPress
    table-layout          -> the page is built with an outdated table layout
    stale-copyright-YYYY  -> the footer still shows YYYY
    no-video              -> there is no video anywhere on the site
  If a signal is not in the list you were given, you may not mention it. In
  particular, never claim anything about overlapping text, broken buttons,
  slow loading, scaling images or specific visual defects unless the matching
  signal was supplied - you cannot see the page.
- You may say what a detected problem tends to cost a business, but frame it as
  a general consequence ("sites on old code often load slowly on phones"), never
  as something you observed on their site.
- Never invent facts, numbers, praise, mutual contacts, or past interactions.
- Never claim to have used their product, visited their premises, or spoken to them before.
- No flattery. "Rich history", "great way to engage", "love what you're doing",
  "enhance your online presence" are all banned - they say nothing and signal a template.
- Never hedge with "may be due for an update" or "could potentially". Say the
  specific thing that is wrong, plainly.
- The subject must be lowercase-ish, specific and under 60 characters. Never start
  it with "Re:" or "Fwd:" - that is deceptive.
- The subject MUST name the business or the specific detail you are writing about.
  Generic subjects are rejected automatically. Bad: "website update", "quick question",
  "your website", "hello". Good: "Khandoker's curry club page", "the Y Club booking form
  on mobile", "Armenian Taverna site on phones".
- The closing question must ask for something tiny and concrete: "Want me to
  send a screenshot?", "Shall I send two examples?", "Worth a look?". Never
  "Are you open to discussing..." or "Would you like to schedule a call?" -
  asking a stranger for a meeting in a first email is too big an ask.
- Do NOT write a signature, sign-off block, unsubscribe line, or postal address.
  Those are appended automatically. End after the closing question, or with a
  single short sign-off word.
- Do not use placeholder tokens like [NAME], {{company}} or TODO. If you do not
  know something, leave it out entirely.

Respond with JSON only, matching exactly:
{"subject":"...","body":"...","hookUsed":"..."}`;

const followUpGuidance: Record<MessageKind, string> = {
  initial:
    'This is the first email. Lead with what you noticed about them; introduce yourself in one short sentence only after that.',
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
