import { logger } from '../../shared/logger.js';
import { CampaignModel } from '../campaigns/campaign.model.js';
import { draftForLead } from '../drafting/drafting.service.js';
import { isReplyDetectionHealthy } from '../email/inbox.service.js';
import { LeadModel } from '../leads/lead.model.js';
import { computeNextFollowUp, isFollowUpDue } from './follow-up.js';
import { kindForStep, OutreachMessageModel } from './outreach-message.model.js';

export type FollowUpStats = {
  due: number;
  drafted: number;
  skipped: number;
  failed: number;
  blockedReason?: string;
};

export const followUpService = {
  async runFollowUpScan(): Promise<FollowUpStats> {
    const stats: FollowUpStats = { due: 0, drafted: 0, skipped: 0, failed: 0 };

    // The single most important guard in the whole system: without working reply
    // detection we could email someone who already responded.
    if (!isReplyDetectionHealthy()) {
      stats.blockedReason =
        'Reply detection is unavailable or stale, so follow-ups are paused to avoid chasing someone who already replied';
      logger.warn(stats.blockedReason);
      return stats;
    }

    const now = new Date();
    const leads = await LeadModel.find({
      status: 'contacted',
      nextFollowUpAt: { $ne: null, $lte: now },
    }).limit(25);

    for (const lead of leads) {
      if (!isFollowUpDue(lead.nextFollowUpAt, now)) {
        continue;
      }

      stats.due += 1;

      const campaign = await CampaignModel.findById(lead.campaignId);

      if (!campaign || campaign.status !== 'active') {
        stats.skipped += 1;
        continue;
      }

      const decision = computeNextFollowUp({
        config: campaign.followUp,
        sequenceStep: lead.sequenceStep,
        lastSentAt: lead.lastContactedAt ?? now,
        replied: Boolean(lead.repliedAt),
        replyDetectionHealthy: true,
      });

      if (!decision.schedule) {
        lead.nextFollowUpAt = null;
        await lead.save();
        stats.skipped += 1;
        continue;
      }

      const kind = kindForStep(lead.sequenceStep);
      const existing = await OutreachMessageModel.findOne({ leadId: lead._id, kind })
        .select('_id')
        .lean();

      if (existing) {
        stats.skipped += 1;
        continue;
      }

      try {
        const result = await draftForLead(lead, campaign, kind);

        if (result.ok) {
          stats.drafted += 1;
          // Cleared so the scan does not pick it up again while it awaits approval.
          lead.nextFollowUpAt = null;
          await lead.save();
        } else {
          stats.skipped += 1;
        }
      } catch (error) {
        stats.failed += 1;
        logger.warn({ error, leadId: lead.id }, 'Follow-up drafting failed');
      }
    }

    logger.info({ stats }, 'Follow-up scan complete');
    return stats;
  },
};
