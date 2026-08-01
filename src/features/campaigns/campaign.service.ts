import { Types } from 'mongoose';
import { ApiError } from '../../shared/api-error.js';
import { getPagination } from '../../shared/pagination.js';
import { CampaignModel, type CampaignDocument } from './campaign.model.js';
import type {
  CreateCampaignInput,
  ListCampaignsQuery,
  UpdateCampaignInput,
} from './campaign.schemas.js';

const assertReadyToActivate = (campaign: CampaignDocument) => {
  if (!campaign.sender.physicalAddress) {
    throw new ApiError(
      422,
      'A sender physical address is legally required — it appears in every exported email',
      'SENDER_ADDRESS_REQUIRED',
    );
  }

  if (campaign.services.length === 0) {
    throw new ApiError(422, 'Add at least one service before activating', 'SERVICES_REQUIRED');
  }

  if (!campaign.offer.trim()) {
    throw new ApiError(422, 'Add an offer description before activating', 'OFFER_REQUIRED');
  }
};

const findOwned = async (id: string, ownerId: string) => {
  const campaign = await CampaignModel.findOne({
    _id: new Types.ObjectId(id),
    ownerId: new Types.ObjectId(ownerId),
  });

  if (!campaign) {
    throw new ApiError(404, 'Campaign not found', 'CAMPAIGN_NOT_FOUND');
  }

  return campaign;
};

export const campaignService = {
  async list(ownerId: string, query: ListCampaignsQuery) {
    const { page, limit, skip } = getPagination(query);
    const filter: Record<string, unknown> = { ownerId: new Types.ObjectId(ownerId) };

    if (query.status) {
      filter.status = query.status;
    }

    const [items, total] = await Promise.all([
      CampaignModel.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
      CampaignModel.countDocuments(filter),
    ]);

    return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },

  async getById(id: string, ownerId: string) {
    return findOwned(id, ownerId);
  },

  async create(ownerId: string, input: CreateCampaignInput) {
    // sending/followUp are no longer meaningful — this app has no send
    // capability — but the fields stay on the schema for older documents, so
    // any values a caller supplies are still accepted rather than rejected.
    return CampaignModel.create({
      ...input,
      ownerId: new Types.ObjectId(ownerId),
      status: 'draft',
    });
  },

  async update(id: string, ownerId: string, input: UpdateCampaignInput) {
    const campaign = await findOwned(id, ownerId);
    const { status, sending, followUp, ...rest } = input;

    Object.assign(campaign, rest);

    if (sending) {
      campaign.sending = { ...campaign.sending, ...sending };
    }

    if (followUp) {
      campaign.followUp = { ...campaign.followUp, ...followUp };
    }

    if (status && status !== campaign.status) {
      if (status === 'active') {
        assertReadyToActivate(campaign);
      }

      campaign.status = status;
    }

    await campaign.save();
    return campaign;
  },

  async remove(id: string, ownerId: string) {
    const campaign = await findOwned(id, ownerId);
    campaign.status = 'archived';
    await campaign.save();
    return campaign;
  },

  /** Campaigns the pipeline is allowed to act on. */
  async listActive() {
    return CampaignModel.find({ status: 'active' });
  },
};
