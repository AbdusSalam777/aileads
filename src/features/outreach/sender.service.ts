import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';
import { CampaignModel } from '../campaigns/campaign.model.js';
import { suppressionService } from '../compliance/suppression.service.js';
import { getTransport } from '../email/mailer.js';
import { buildMessage } from '../email/message-builder.js';
import { LeadModel } from '../leads/lead.model.js';
import { applyStatus } from '../leads/lead.service.js';
import { OutreachMessageModel, type OutreachMessageDocument } from './outreach-message.model.js';
import { computeNextFollowUp } from './follow-up.js';
import {
  canSendNow,
  computeNextSendAt,
  localDayKey,
  toSendWindowConfig,
} from './send-window.js';

export type SendStats = {
  attempted: number;
  sent: number;
  blocked: number;
  suppressed: number;
  failed: number;
  blockReason?: string;
};

export const unsubscribeUrlFor = (token: string) =>
  `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/u/${token}`;

const countSentToday = async (campaignId: unknown, timezone: string) => {
  const today = localDayKey(new Date(), timezone);
  const since = new Date();
  since.setUTCHours(since.getUTCHours() - 48);

  const recent = await OutreachMessageModel.find({
    campaignId,
    status: 'sent',
    sentAt: { $gte: since },
  })
    .select('sentAt')
    .lean();

  return recent.filter((message) => message.sentAt && localDayKey(message.sentAt, timezone) === today)
    .length;
};

const lastSentAtFor = async (campaignId: unknown) => {
  const last = await OutreachMessageModel.findOne({ campaignId, status: 'sent' })
    .sort({ sentAt: -1 })
    .select('sentAt')
    .lean();

  return last?.sentAt ?? null;
};

const failMessage = async (message: OutreachMessageDocument, reason: string) => {
  message.status = 'failed';
  message.failureReason = reason;
  await message.save();
};

/**
 * Sends at most ONE message per invocation. With a five-minute tick and a
 * randomised gap this makes a burst impossible even if the caller misbehaves.
 */
export const senderService = {
  async runSendCycle(): Promise<SendStats> {
    const stats: SendStats = { attempted: 0, sent: 0, blocked: 0, suppressed: 0, failed: 0 };

    const due = await OutreachMessageModel.findOne({
      status: 'approved',
      $or: [{ scheduledFor: null }, { scheduledFor: { $lte: new Date() } }],
    }).sort({ scheduledFor: 1, approvedAt: 1 });

    if (!due) {
      return stats;
    }

    stats.attempted = 1;

    const campaign = await CampaignModel.findById(due.campaignId);
    const lead = await LeadModel.findById(due.leadId);

    if (!campaign || !lead) {
      stats.failed += 1;
      await failMessage(due, 'campaign or lead no longer exists');
      return stats;
    }

    // The env cap is a hard ceiling the campaign can lower but never exceed.
    const config = toSendWindowConfig(campaign.sending, env.EMAIL_DAILY_CAP);

    const decision = canSendNow({
      now: new Date(),
      config,
      sentToday: await countSentToday(campaign._id, config.timezone),
      lastSentAt: await lastSentAtFor(campaign._id),
      outreachEnabled: env.OUTREACH_ENABLED && campaign.status === 'active',
    });

    if (!decision.allowed) {
      stats.blocked += 1;
      stats.blockReason = decision.reason;
      logger.info({ code: decision.code, reason: decision.reason }, 'Send blocked by gate');
      return stats;
    }

    // Re-checked here, not just at draft time: an address can be suppressed while
    // a draft waits for approval.
    if (await suppressionService.isSuppressed(due.toEmail)) {
      stats.suppressed += 1;
      due.status = 'cancelled';
      due.failureReason = 'recipient is on the suppression list';
      await due.save();
      await applyStatus(lead, 'do_not_contact', 'suppressed before send');
      await lead.save();
      return stats;
    }

    // Atomic claim: if two ticks overlap, only one transitions approved -> sending.
    const claimed = await OutreachMessageModel.findOneAndUpdate(
      { _id: due._id, status: 'approved' },
      { $set: { status: 'sending' }, $inc: { attempts: 1 } },
      { new: true },
    );

    if (!claimed) {
      stats.blocked += 1;
      stats.blockReason = 'message was claimed by another run';
      return stats;
    }

    const message = buildMessage({
      toEmail: claimed.toEmail,
      subject: claimed.subject,
      body: claimed.body,
      sender: campaign.sender,
      unsubscribeUrl: unsubscribeUrlFor(claimed.unsubscribeToken),
      // Always the authenticated mailbox, never the campaign's reply address.
      fromAddress: env.SMTP_USER ?? campaign.sender.email,
    });

    try {
      const info = await getTransport().sendMail(message);

      claimed.status = 'sent';
      claimed.sentAt = new Date();
      claimed.messageId = info.messageId;
      claimed.dryRun = env.EMAIL_DRY_RUN;
      claimed.smtpResponse = env.EMAIL_DRY_RUN
        ? 'DRY RUN — message built but not sent'
        : String(info.response ?? 'sent');
      await claimed.save();

      lead.sequenceStep += 1;
      lead.lastContactedAt = claimed.sentAt;

      if (lead.status !== 'contacted') {
        await applyStatus(lead, 'contacted', `sent ${claimed.kind}`);
      }

      const followUp = computeNextFollowUp({
        config: campaign.followUp,
        sequenceStep: lead.sequenceStep,
        lastSentAt: claimed.sentAt,
        replied: false,
        replyDetectionHealthy: env.IMAP_ENABLED,
      });

      lead.nextFollowUpAt = followUp.schedule ? followUp.at : null;
      await lead.save();

      // Space the next approved message out so the queue drips rather than bursts.
      const nextAt = computeNextSendAt(claimed.sentAt, config);
      await OutreachMessageModel.updateMany(
        { campaignId: campaign._id, status: 'approved', scheduledFor: { $lte: nextAt } },
        { $set: { scheduledFor: nextAt } },
      );

      stats.sent += 1;
      logger.info(
        { messageId: claimed.messageId, dryRun: env.EMAIL_DRY_RUN, kind: claimed.kind },
        'Outreach message sent',
      );
    } catch (error) {
      stats.failed += 1;
      const reason = error instanceof Error ? error.message : 'Unknown send error';
      await failMessage(claimed, reason);
      logger.error({ error, messageId: claimed.id }, 'Send failed');
    }

    return stats;
  },

  /**
   * A crash or dev-server restart can leave a message stuck in `sending`. Fail it
   * on boot rather than resending, since we cannot know whether SMTP accepted it.
   */
  async resetStaleSending() {
    const result = await OutreachMessageModel.updateMany(
      { status: 'sending' },
      {
        $set: {
          status: 'failed',
          failureReason: 'Process restarted while sending; not retried to avoid a duplicate email',
        },
      },
    );

    if (result.modifiedCount > 0) {
      logger.warn({ count: result.modifiedCount }, 'Reset stale sending messages on boot');
    }

    return result.modifiedCount;
  },
};
