import { truncate } from '../../../shared/text.js';
import type { CampaignDocument } from '../../campaigns/campaign.model.js';
import type { LeadDocument } from '../../leads/lead.model.js';
import { TASK_MARKERS } from '../stub.provider.js';

export const qualificationSystemPrompt = `${TASK_MARKERS.qualification}
You assess whether a sales lead is genuinely worth a freelancer's time.

The freelancer sells: web development / full-stack development, and video editing.

Score 0-100 on how likely this lead is to become a paying client soon.

There are TWO kinds of lead and they must be judged by different standards.
The lead source tells you which one you are looking at.

=== INTENT leads: they publicly asked for work to be done ===

Score HIGH when:
- They asked for exactly this kind of work, recently
- They named a real budget worth the freelancer's time
- The work is ongoing or long-term rather than a one-off micro-task

Score LOW when:
- They are advertising their own availability rather than hiring
- The work is unpaid, equity-only, or the budget is insultingly small
- The need is unrelated to web or video work

=== DIRECTORY leads: a real business that has NOT asked for anything ===

These will never have a posted request or a stated budget. That is normal and
must NOT count against them - judging them on missing intent signals is a
category error that wrongly rejects every good local business.

Judge them ONLY on fit and on evidence their site needs work:
- Score HIGHER the more concrete, fixable problems their site shows
  (not mobile friendly, outdated platform, legacy code, stale copyright,
  no video, no meta description)
- Score HIGHER when the business type plainly depends on its website to win
  customers - restaurants, gyms, salons, dentists, trades, local services
- Score HIGHER when there is a specific, verifiable detail to open an email with
- Score LOWER when the site already looks modern and well maintained, when the
  business is a large chain or franchise that will not hire a freelancer, or
  when it is a branch of a national brand rather than an independent

A directory lead with two or more fixable site problems and a real local
business behind it is a reasonable outreach slot. Do not mark it down merely
because nobody asked.

Be sceptical but fair. Use the full range and do not inflate.

personalizationHooks must be CONCRETE, VERIFIABLE details taken only from the
supplied context - something the freelancer could reference in a first email and
be certain is true. Never invent facts, numbers, names, or events. If there is
nothing specific to say, return an empty list.

Respond with JSON only, matching exactly:
{"score":<0-100>,"tier":"hot"|"warm"|"cold","reasons":["..."],"personalizationHooks":["..."],"serviceFit":["..."],"recommendation":"contact"|"skip"}`;

export const buildQualificationUserPrompt = (
  lead: LeadDocument,
  campaign: CampaignDocument,
): string => {
  const lines: string[] = [
    `Freelancer services: ${campaign.services.join(', ') || 'web development, video editing'}`,
    `Ideal customer: ${truncate(campaign.icp || 'small businesses and agencies', 400)}`,
    '',
    `Business: ${lead.company ?? lead.name}`,
    `Lead source: ${lead.source} (${lead.sourceKind === 'intent' ? 'they posted asking for work to be done' : 'found in a business directory, has not asked for anything'})`,
  ];

  if (lead.postedAt) {
    const ageHours = Math.round((Date.now() - lead.postedAt.getTime()) / 3_600_000);
    lines.push(`Post age: ${ageHours} hours`);
  }

  if (lead.location) {
    lines.push(`Location: ${lead.location}`);
  }

  if (lead.category) {
    lines.push(`Category: ${lead.category}`);
  }

  if (lead.intent) {
    lines.push('', `Post title: ${lead.intent.title}`);

    if (lead.intent.budgetText) {
      lines.push(`Stated budget: ${lead.intent.budgetText}`);
    }

    lines.push(`Post body: ${truncate(lead.intent.excerpt, 1200)}`);
  }

  if (lead.site) {
    lines.push(
      '',
      `Site signals: ${lead.site.techSignals.join(', ') || 'none detected'}`,
      `Site title: ${lead.site.title ?? 'unknown'}`,
      `Site excerpt: ${truncate(lead.site.excerpt ?? '', 1200)}`,
    );
  } else if (lead.websiteUrl) {
    lines.push('', 'Site signals: site could not be read');
  } else {
    lines.push('', 'Site signals: no website found at all');
  }

  return lines.join('\n');
};
