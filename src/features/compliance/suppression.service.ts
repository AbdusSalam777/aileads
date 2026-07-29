import { Types } from 'mongoose';
import { getPagination } from '../../shared/pagination.js';
import { logger } from '../../shared/logger.js';
import {
  SuppressionModel,
  type SuppressionReason,
  type SuppressionType,
} from './suppression.model.js';

export type AddSuppressionInput = {
  type: SuppressionType;
  value: string;
  reason: SuppressionReason;
  note?: string;
  leadId?: string;
};

const domainOf = (email: string) => email.split('@')[1] ?? '';

export const suppressionService = {
  /**
   * Checked immediately before every send, not just at draft time — an address
   * can be suppressed while a draft sits in the approval queue.
   */
  async isSuppressed(email: string): Promise<boolean> {
    const normalized = email.trim().toLowerCase();

    if (!normalized) {
      return true;
    }

    const match = await SuppressionModel.findOne({
      $or: [
        { type: 'email', value: normalized },
        { type: 'domain', value: domainOf(normalized) },
      ],
    })
      .select('_id')
      .lean();

    return Boolean(match);
  },

  async add(input: AddSuppressionInput) {
    const value = input.value.trim().toLowerCase();

    const suppression = await SuppressionModel.findOneAndUpdate(
      { type: input.type, value },
      {
        $set: {
          reason: input.reason,
          note: input.note,
          ...(input.leadId ? { leadId: new Types.ObjectId(input.leadId) } : {}),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    logger.info({ type: input.type, reason: input.reason }, 'Suppression recorded');
    return suppression;
  },

  async remove(id: string) {
    return SuppressionModel.findByIdAndDelete(id);
  },

  async list(query: { page?: number; limit?: number; search?: string }) {
    const { page, limit, skip } = getPagination(query);
    const filter = query.search
      ? { value: new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
      : {};

    const [items, total] = await Promise.all([
      SuppressionModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      SuppressionModel.countDocuments(filter),
    ]);

    return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },
};
