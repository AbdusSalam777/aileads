import { Types, type FilterQuery } from 'mongoose';
import { ApiError } from '../../shared/api-error.js';
import { getPagination } from '../../shared/pagination.js';
import { CampaignModel } from '../campaigns/campaign.model.js';
import { OutreachMessageModel } from '../outreach/outreach-message.model.js';
import { LeadModel, type Lead, type LeadDocument, type LeadStatus } from './lead.model.js';
import { assertTransition, isAbsorbing } from './lead.state.js';
import type { ListLeadsQuery } from './lead.schemas.js';

/** Leads are owned transitively through their campaign. */
const ownedCampaignIds = async (ownerId: string): Promise<Types.ObjectId[]> => {
  const campaigns = await CampaignModel.find({ ownerId: new Types.ObjectId(ownerId) })
    .select('_id')
    .lean();

  return campaigns.map((campaign) => campaign._id);
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildFilter = async (ownerId: string, query: ListLeadsQuery) => {
  const campaignIds = await ownedCampaignIds(ownerId);
  const filter: FilterQuery<Lead> = { campaignId: { $in: campaignIds } };

  if (query.campaignId) {
    const requested = new Types.ObjectId(query.campaignId);

    if (!campaignIds.some((id) => id.equals(requested))) {
      throw new ApiError(404, 'Campaign not found', 'CAMPAIGN_NOT_FOUND');
    }

    filter.campaignId = requested;
  }

  if (query.status) filter.status = query.status;
  if (query.source) filter.source = query.source;
  if (query.contactChannel) filter.contactChannel = query.contactChannel;
  if (query.minScore !== undefined) filter['ai.score'] = { $gte: query.minScore };

  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [
      { name: pattern },
      { company: pattern },
      { contactEmail: pattern },
      { 'intent.title': pattern },
    ];
  }

  return filter;
};

export const leadService = {
  async list(ownerId: string, query: ListLeadsQuery) {
    const { page, limit, skip } = getPagination(query);
    const filter = await buildFilter(ownerId, query);
    const sort: Record<string, -1> =
      query.sort === 'score' ? { 'ai.score': -1 } : { updatedAt: -1 };

    const [items, total] = await Promise.all([
      LeadModel.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      LeadModel.countDocuments(filter),
    ]);

    return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },

  async getById(id: string, ownerId: string) {
    const campaignIds = await ownedCampaignIds(ownerId);
    const lead = await LeadModel.findOne({
      _id: new Types.ObjectId(id),
      campaignId: { $in: campaignIds },
    });

    if (!lead) {
      throw new ApiError(404, 'Lead not found', 'LEAD_NOT_FOUND');
    }

    return lead;
  },

  async getWithMessages(id: string, ownerId: string) {
    const lead = await this.getById(id, ownerId);
    const messages = await OutreachMessageModel.find({ leadId: lead._id })
      .sort({ createdAt: 1 })
      .lean();

    return { lead, messages };
  },

  async updateStatus(id: string, ownerId: string, status: LeadStatus, reason?: string) {
    const lead = await this.getById(id, ownerId);
    assertTransition(lead.status, status);
    await applyStatus(lead, status, reason ?? 'manual update');
    await lead.save();

    // Entering a terminal state must retire anything still queued for this lead.
    if (isAbsorbing(status)) {
      await cancelPendingMessages(lead._id, `lead ${status}`);
    }

    return lead;
  },

  async addNote(id: string, ownerId: string, body: string) {
    const lead = await this.getById(id, ownerId);
    lead.notes.push({ body, authorId: new Types.ObjectId(ownerId), at: new Date() });
    await lead.save();
    return lead;
  },

  async statsByStatus(ownerId: string, campaignId?: string) {
    const campaignIds = await ownedCampaignIds(ownerId);
    const match: FilterQuery<Lead> = { campaignId: { $in: campaignIds } };

    if (campaignId) {
      match.campaignId = new Types.ObjectId(campaignId);
    }

    const rows = await LeadModel.aggregate<{ _id: LeadStatus; count: number }>([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    return Object.fromEntries(rows.map((row) => [row._id, row.count])) as Record<
      LeadStatus,
      number
    >;
  },
};

/** Records the transition in history as well as setting it, so the UI can show a timeline. */
export const applyStatus = async (lead: LeadDocument, to: LeadStatus, reason: string) => {
  lead.statusHistory.push({ from: lead.status, to, reason, at: new Date() });
  lead.status = to;
};

export const cancelPendingMessages = async (leadId: Types.ObjectId, reason: string) => {
  await OutreachMessageModel.updateMany(
    { leadId, status: { $in: ['draft', 'approved'] } },
    { $set: { status: 'cancelled', failureReason: reason } },
  );
};
