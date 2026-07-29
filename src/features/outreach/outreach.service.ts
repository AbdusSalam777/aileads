import { Types, type FilterQuery } from 'mongoose';
import { env } from '../../config/env.js';
import { ApiError } from '../../shared/api-error.js';
import { getPagination } from '../../shared/pagination.js';
import { CampaignModel } from '../campaigns/campaign.model.js';
import { suppressionService } from '../compliance/suppression.service.js';
import { buildMessageText } from '../email/message-builder.js';
import { LeadModel } from '../leads/lead.model.js';
import { applyStatus } from '../leads/lead.service.js';
import {
  OutreachMessageModel,
  type MessageStatus,
  type OutreachMessage,
} from './outreach-message.model.js';
import {
  canSendNow,
  computeNextSendAt,
  localDayKey,
  toSendWindowConfig,
} from './send-window.js';
import { unsubscribeUrlFor } from './sender.service.js';

const ownedCampaignIds = async (ownerId: string) => {
  const campaigns = await CampaignModel.find({ ownerId: new Types.ObjectId(ownerId) })
    .select('_id')
    .lean();

  return campaigns.map((campaign) => campaign._id);
};

const findOwnedMessage = async (id: string, ownerId: string) => {
  const campaignIds = await ownedCampaignIds(ownerId);
  const message = await OutreachMessageModel.findOne({
    _id: new Types.ObjectId(id),
    campaignId: { $in: campaignIds },
  });

  if (!message) {
    throw new ApiError(404, 'Message not found', 'MESSAGE_NOT_FOUND');
  }

  return message;
};

export const outreachService = {
  async list(
    ownerId: string,
    query: { status?: MessageStatus; campaignId?: string; page?: number; limit?: number },
  ) {
    const { page, limit, skip } = getPagination(query);
    const campaignIds = await ownedCampaignIds(ownerId);
    const filter: FilterQuery<OutreachMessage> = { campaignId: { $in: campaignIds } };

    if (query.status) filter.status = query.status;
    if (query.campaignId) filter.campaignId = new Types.ObjectId(query.campaignId);

    const [items, total] = await Promise.all([
      OutreachMessageModel.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('leadId', 'name company websiteUrl contactEmail ai intent source status')
        .lean(),
      OutreachMessageModel.countDocuments(filter),
    ]);

    return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },

  async getById(id: string, ownerId: string) {
    const message = await findOwnedMessage(id, ownerId);
    const lead = await LeadModel.findById(message.leadId).lean();
    const campaign = await CampaignModel.findById(message.campaignId).lean();

    // Show the reviewer exactly what will be sent, footer included.
    const preview = campaign
      ? buildMessageText({
          toEmail: message.toEmail,
          subject: message.subject,
          body: message.body,
          sender: campaign.sender,
          unsubscribeUrl: unsubscribeUrlFor(message.unsubscribeToken),
        })
      : message.body;

    return { message, lead, preview };
  },

  async update(id: string, ownerId: string, input: { subject?: string; body?: string }) {
    const message = await findOwnedMessage(id, ownerId);

    if (message.status !== 'draft') {
      throw new ApiError(409, 'Only drafts can be edited', 'MESSAGE_NOT_EDITABLE');
    }

    if (input.subject !== undefined) message.subject = input.subject.trim();
    if (input.body !== undefined) message.body = input.body.trim();

    await message.save();
    return message;
  },

  async approve(id: string, ownerId: string) {
    const message = await findOwnedMessage(id, ownerId);

    if (message.status !== 'draft') {
      throw new ApiError(409, 'Only drafts can be approved', 'MESSAGE_NOT_APPROVABLE');
    }

    if (await suppressionService.isSuppressed(message.toEmail)) {
      throw new ApiError(409, 'Recipient is on the suppression list', 'RECIPIENT_SUPPRESSED');
    }

    const campaign = await CampaignModel.findById(message.campaignId);

    if (!campaign) {
      throw new ApiError(404, 'Campaign not found', 'CAMPAIGN_NOT_FOUND');
    }

    const config = toSendWindowConfig(campaign.sending);
    const lastApproved = await OutreachMessageModel.findOne({
      campaignId: campaign._id,
      status: 'approved',
    })
      .sort({ scheduledFor: -1 })
      .select('scheduledFor')
      .lean();

    const anchor = lastApproved?.scheduledFor ?? new Date();

    message.status = 'approved';
    message.approvedAt = new Date();
    message.approvedBy = new Types.ObjectId(ownerId);
    message.scheduledFor = computeNextSendAt(anchor, config);
    await message.save();

    return message;
  },

  async discard(id: string, ownerId: string, reason?: string) {
    const message = await findOwnedMessage(id, ownerId);

    if (message.status === 'sent') {
      throw new ApiError(409, 'Sent messages cannot be discarded', 'MESSAGE_ALREADY_SENT');
    }

    message.status = 'cancelled';
    message.failureReason = reason ?? 'discarded by user';
    await message.save();

    const lead = await LeadModel.findById(message.leadId);

    if (lead && lead.status === 'drafting') {
      await applyStatus(lead, 'disqualified', 'draft discarded by user');
      await lead.save();
    }

    return message;
  },

  /** Powers the send-queue panel: what the operator needs to trust the system. */
  async queueStatus(ownerId: string) {
    const campaignIds = await ownedCampaignIds(ownerId);
    const campaigns = await CampaignModel.find({ _id: { $in: campaignIds } }).lean();
    const primary = campaigns.find((c) => c.status === 'active') ?? campaigns[0];

    const timezone = primary?.sending.timezone ?? env.TIMEZONE;
    const today = localDayKey(new Date(), timezone);

    const since = new Date();
    since.setUTCHours(since.getUTCHours() - 48);

    const recentSent = await OutreachMessageModel.find({
      campaignId: { $in: campaignIds },
      status: 'sent',
      sentAt: { $gte: since },
    })
      .select('sentAt')
      .lean();

    const sentToday = recentSent.filter(
      (message) => message.sentAt && localDayKey(message.sentAt, timezone) === today,
    ).length;

    const [pendingApproval, approved, nextUp] = await Promise.all([
      OutreachMessageModel.countDocuments({ campaignId: { $in: campaignIds }, status: 'draft' }),
      OutreachMessageModel.countDocuments({ campaignId: { $in: campaignIds }, status: 'approved' }),
      OutreachMessageModel.findOne({ campaignId: { $in: campaignIds }, status: 'approved' })
        .sort({ scheduledFor: 1 })
        .select('scheduledFor')
        .lean(),
    ]);

    const dailyCap = Math.min(primary?.sending.dailyCap ?? env.EMAIL_DAILY_CAP, env.EMAIL_DAILY_CAP);

    const decision = primary
      ? canSendNow({
          now: new Date(),
          config: toSendWindowConfig(primary.sending, env.EMAIL_DAILY_CAP),
          sentToday,
          lastSentAt: recentSent.at(-1)?.sentAt ?? null,
          outreachEnabled: env.OUTREACH_ENABLED && primary.status === 'active',
        })
      : { allowed: false as const, code: 'OUTREACH_DISABLED' as const, reason: 'No campaign yet' };

    return {
      sentToday,
      dailyCap,
      envDailyCap: env.EMAIL_DAILY_CAP,
      pendingApproval,
      approved,
      nextScheduledFor: nextUp?.scheduledFor ?? null,
      timezone,
      outreachEnabled: env.OUTREACH_ENABLED,
      dryRun: env.EMAIL_DRY_RUN,
      canSendNow: decision.allowed,
      blockedReason: decision.allowed ? undefined : decision.reason,
    };
  },
};
