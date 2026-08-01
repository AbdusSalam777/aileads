import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';
import { chatJson } from '../ai/ai.client.js';
import { draftOutputSchema } from '../ai/ai.schemas.js';
import { buildDraftUserPrompt, draftSystemPrompt } from '../ai/prompts/outreach-draft.prompt.js';
import { CampaignModel, type CampaignDocument } from '../campaigns/campaign.model.js';
import { suppressionService } from '../compliance/suppression.service.js';
import { createUnsubscribeToken } from '../compliance/unsubscribe-token.js';
import { LeadModel, type LeadDocument } from '../leads/lead.model.js';
import { applyStatus } from '../leads/lead.service.js';
import {
  kindForStep,
  OutreachMessageModel,
  type MessageKind,
} from '../outreach/outreach-message.model.js';
import { hasBlockingIssue, validateDraft } from './draft-validator.js';

export type DraftingStats = {
  processed: number;
  drafted: number;
  rejected: number;
  suppressed: number;
  failed: number;
};

/** True when the address is the operator's own mailbox or on their own domain. */
export const isSelfAddress = (email: string, campaign: CampaignDocument): boolean => {
  const target = email.trim().toLowerCase();
  const own = campaign.sender.email?.trim().toLowerCase();

  if (!own) {
    return false;
  }

  const ownDomain = own.split('@')[1];
  return target === own || (Boolean(ownDomain) && target.endsWith(`@${ownDomain}`));
};

export const draftForLead = async (
  lead: LeadDocument,
  campaign: CampaignDocument,
  kind: MessageKind,
): Promise<{ ok: boolean; reason?: string }> => {
  if (!lead.contactEmail) {
    return { ok: false, reason: 'lead has no email address' };
  }

  if (await suppressionService.isSuppressed(lead.contactEmail)) {
    return { ok: false, reason: 'suppressed' };
  }

  // Scraping picks up our own address from pages that mention it, which would
  // otherwise mean cold-emailing ourselves.
  if (isSelfAddress(lead.contactEmail, campaign)) {
    return { ok: false, reason: 'address belongs to the sender' };
  }

  const existing = await OutreachMessageModel.findOne({ leadId: lead._id, kind }).select('_id').lean();

  if (existing) {
    return { ok: false, reason: 'message already exists for this step' };
  }

  const previous =
    kind === 'initial'
      ? undefined
      : await OutreachMessageModel.findOne({ leadId: lead._id, status: 'sent' })
          .sort({ sentAt: -1 })
          .lean();

  const { data, model } = await chatJson(
    {
      system: draftSystemPrompt,
      user: buildDraftUserPrompt(lead, campaign, kind, previous?.body),
      temperature: 0.6,
      maxTokens: 700,
    },
    draftOutputSchema,
  );

  const issues = validateDraft({ subject: data.subject, body: data.body });

  if (hasBlockingIssue(issues)) {
    logger.warn({ leadId: lead.id, issues }, 'Draft rejected by validator');
    return { ok: false, reason: `validator: ${issues.map((i) => i.code).join(', ')}` };
  }

  await OutreachMessageModel.create({
    leadId: lead._id,
    campaignId: campaign._id,
    kind,
    status: 'draft',
    toEmail: lead.contactEmail,
    subject: data.subject.trim(),
    body: data.body.trim(),
    aiSubject: data.subject.trim(),
    aiBody: data.body.trim(),
    aiModel: model,
    validationIssues: issues.map((issue) => `${issue.severity}: ${issue.message}`),
    unsubscribeToken: createUnsubscribeToken({ email: lead.contactEmail, leadId: lead.id }),
  });

  return { ok: true };
};

export const draftingService = {
  async runDrafting(limit = env.AI_BATCH_SIZE): Promise<DraftingStats> {
    const stats: DraftingStats = { processed: 0, drafted: 0, rejected: 0, suppressed: 0, failed: 0 };

    const leads = await LeadModel.find({ status: 'qualified', contactChannel: 'email' })
      .sort({ 'ai.score': -1 })
      .limit(limit);

    for (const lead of leads) {
      stats.processed += 1;

      const campaign = await CampaignModel.findById(lead.campaignId);

      if (!campaign) {
        stats.failed += 1;
        continue;
      }

      try {
        const result = await draftForLead(lead, campaign, kindForStep(lead.sequenceStep));

        if (result.ok) {
          stats.drafted += 1;
          await applyStatus(lead, 'drafting', 'draft created, awaiting approval');
          await lead.save();
          continue;
        }

        if (result.reason === 'suppressed') {
          stats.suppressed += 1;
          await applyStatus(lead, 'do_not_contact', 'address is on the suppression list');
        } else {
          stats.rejected += 1;
          await applyStatus(lead, 'disqualified', result.reason ?? 'draft rejected');
        }

        await lead.save();
      } catch (error) {
        stats.failed += 1;
        logger.warn({ error, leadId: lead.id }, 'Drafting failed for lead');
      }
    }

    logger.info({ stats }, 'Drafting run complete');
    return stats;
  },
};
