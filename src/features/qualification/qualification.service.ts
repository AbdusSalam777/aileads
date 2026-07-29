import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';
import { chatJson } from '../ai/ai.client.js';
import { qualificationOutputSchema } from '../ai/ai.schemas.js';
import {
  buildQualificationUserPrompt,
  qualificationSystemPrompt,
} from '../ai/prompts/qualification.prompt.js';
import { CampaignModel, type CampaignDocument } from '../campaigns/campaign.model.js';
import { LeadModel, type LeadAiAssessment, type LeadDocument } from '../leads/lead.model.js';
import { applyStatus } from '../leads/lead.service.js';

export type QualificationStats = {
  processed: number;
  qualified: number;
  disqualified: number;
  failed: number;
};

const qualifyOne = async (
  lead: LeadDocument,
  campaign: CampaignDocument,
  stats: QualificationStats,
) => {
  await applyStatus(lead, 'qualifying', 'qualification started');
  await lead.save();

  const { data, model } = await chatJson(
    {
      system: qualificationSystemPrompt,
      user: buildQualificationUserPrompt(lead, campaign),
      temperature: 0.2,
      maxTokens: 700,
    },
    qualificationOutputSchema,
  );

  const assessment: LeadAiAssessment = {
    score: Math.round(data.score),
    tier: data.tier,
    reasons: data.reasons,
    personalizationHooks: data.personalizationHooks ?? [],
    serviceFit: data.serviceFit ?? [],
    model,
    qualifiedAt: new Date(),
  };

  lead.ai = assessment;

  const passes = data.recommendation === 'contact' && assessment.score >= campaign.minScoreToDraft;

  if (passes) {
    stats.qualified += 1;
    await applyStatus(lead, 'qualified', `scored ${assessment.score}`);
  } else {
    stats.disqualified += 1;
    await applyStatus(
      lead,
      'disqualified',
      data.recommendation === 'skip'
        ? 'model recommended skipping'
        : `scored ${assessment.score}, below threshold ${campaign.minScoreToDraft}`,
    );
  }

  await lead.save();
};

export const qualificationService = {
  async runQualification(limit = env.AI_BATCH_SIZE): Promise<QualificationStats> {
    const stats: QualificationStats = { processed: 0, qualified: 0, disqualified: 0, failed: 0 };

    const leads = await LeadModel.find({ status: 'enriched' })
      .sort({ 'intent.signalScore': -1, createdAt: 1 })
      .limit(limit);

    for (const lead of leads) {
      stats.processed += 1;

      const campaign = await CampaignModel.findById(lead.campaignId);

      if (!campaign) {
        stats.failed += 1;
        continue;
      }

      try {
        await qualifyOne(lead, campaign, stats);
      } catch (error) {
        // Roll back to `enriched` so the next run retries, rather than
        // disqualifying someone just because the model was unavailable.
        stats.failed += 1;
        logger.warn({ error, leadId: lead.id }, 'Qualification failed for lead');
        await applyStatus(lead, 'enriched', 'qualification failed, will retry');
        await lead.save();
      }
    }

    logger.info({ stats }, 'Qualification run complete');
    return stats;
  },
};
