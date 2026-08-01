import { Types, type FilterQuery } from 'mongoose';
import { ApiError } from '../../shared/api-error.js';
import { getPagination } from '../../shared/pagination.js';
import { CampaignModel, type CampaignDocument } from '../campaigns/campaign.model.js';
import { suppressionService } from '../compliance/suppression.service.js';
import { unsubscribeUrlFor } from '../compliance/unsubscribe-token.js';
import { buildMessageText } from '../email/message-builder.js';
import { LeadModel, type LeadDocument } from '../leads/lead.model.js';
import { applyStatus } from '../leads/lead.service.js';
import {
  OutreachMessageModel,
  type MessageStatus,
  type OutreachMessage,
  type OutreachMessageDocument,
} from './outreach-message.model.js';

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

/** Every field a message needs when it is exported for outreach elsewhere. */
export type ExportedLead = {
  leadId: string;
  name: string;
  email: string;
  website: string | null;
  source: string | null;
  aiScore: number | null;
  subject: string;
  body: string;
  whyThisLead: string[];
  hooks: string[];
  status: MessageStatus;
};

const toExportedLead = (
  message: OutreachMessageDocument,
  lead: LeadDocument | null,
  campaign: CampaignDocument | undefined,
): ExportedLead => ({
  leadId: String(message.leadId),
  name: lead?.company ?? lead?.name ?? '',
  email: message.toEmail,
  website: lead?.websiteUrl ?? null,
  source: lead?.source ?? null,
  aiScore: lead?.ai?.score ?? null,
  subject: message.subject,
  // Full rendered message — signature, postal address and unsubscribe link
  // included — so the compliance footer travels with the copy wherever it is
  // pasted, not just what shipped from this app.
  body: campaign
    ? buildMessageText({
        body: message.body,
        sender: campaign.sender,
        unsubscribeUrl: unsubscribeUrlFor(message.unsubscribeToken),
      })
    : message.body,
  whyThisLead: lead?.ai?.reasons ?? [],
  hooks: lead?.ai?.personalizationHooks ?? [],
  status: message.status,
});

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

    // Show the reviewer exactly what will go out, footer included.
    const preview = campaign
      ? buildMessageText({
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

  /**
   * Marks a draft ready for outreach. There is no send queue any more — this
   * is purely curation, so the lead can be told apart from the ones still
   * awaiting a decision when it is exported.
   */
  async approve(id: string, ownerId: string) {
    const message = await findOwnedMessage(id, ownerId);

    if (message.status !== 'draft') {
      throw new ApiError(409, 'Only drafts can be approved', 'MESSAGE_NOT_APPROVABLE');
    }

    if (await suppressionService.isSuppressed(message.toEmail)) {
      throw new ApiError(409, 'Recipient is on the suppression list', 'RECIPIENT_SUPPRESSED');
    }

    message.status = 'approved';
    message.approvedAt = new Date();
    message.approvedBy = new Types.ObjectId(ownerId);
    await message.save();

    // Records the operator's intent to reach out now, even though the actual
    // send happens outside this app — this is what keeps reply detection and
    // the "contacted" stage of the funnel meaningful.
    const lead = await LeadModel.findById(message.leadId);

    if (lead && lead.status === 'drafting') {
      lead.sequenceStep += 1;
      lead.lastContactedAt = new Date();
      await applyStatus(lead, 'contacted', 'approved for export');
      await lead.save();
    }

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

  /** Counts shown above the Outbox: what still needs a decision, what is ready. */
  async summary(ownerId: string) {
    const campaignIds = await ownedCampaignIds(ownerId);

    const [pendingApproval, approved] = await Promise.all([
      OutreachMessageModel.countDocuments({ campaignId: { $in: campaignIds }, status: 'draft' }),
      OutreachMessageModel.countDocuments({ campaignId: { $in: campaignIds }, status: 'approved' }),
    ]);

    return { pendingApproval, approved };
  },

  /**
   * Everything needed to actually reach out, in one JSON payload: email, name,
   * subject, the full compliant body, why the lead was picked, and the hooks
   * used to personalise it. Sending happens outside this app.
   */
  async exportLeads(ownerId: string, statuses: MessageStatus[] = ['draft', 'approved']) {
    const campaignIds = await ownedCampaignIds(ownerId);
    const campaigns = await CampaignModel.find({ _id: { $in: campaignIds } });
    const campaignMap = new Map(campaigns.map((campaign) => [String(campaign._id), campaign]));

    const messages = await OutreachMessageModel.find({
      campaignId: { $in: campaignIds },
      status: { $in: statuses },
    });

    const leads = await LeadModel.find({
      _id: { $in: messages.map((message) => message.leadId) },
    });
    const leadMap = new Map(leads.map((lead) => [String(lead._id), lead]));

    return messages
      .map((message) =>
        toExportedLead(
          message,
          leadMap.get(String(message.leadId)) ?? null,
          campaignMap.get(String(message.campaignId)),
        ),
      )
      .sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0));
  },
};
