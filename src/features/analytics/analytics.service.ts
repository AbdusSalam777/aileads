import { Types } from 'mongoose';
import { CampaignModel } from '../campaigns/campaign.model.js';
import { LeadModel, leadStatuses, type LeadStatus } from '../leads/lead.model.js';
import { OutreachMessageModel } from '../outreach/outreach-message.model.js';

const ownedCampaignIds = async (ownerId: string) => {
  const campaigns = await CampaignModel.find({ ownerId: new Types.ObjectId(ownerId) })
    .select('_id')
    .lean();

  return campaigns.map((campaign) => campaign._id);
};

const startOfDayUtc = (daysAgo: number) => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date;
};

/**
 * The app has no send capability of its own — 'approved' is where a message's
 * lifecycle here ends, marking that the operator took it to export and send
 * elsewhere. 'sent' is included too so messages from before that change still
 * count towards the totals.
 */
const OUTREACH_DONE_STATUSES = ['approved', 'sent'] as const;

const outreachTimestamp = (message: { sentAt?: Date; approvedAt?: Date }) =>
  message.sentAt ?? message.approvedAt;

export const analyticsService = {
  async overview(ownerId: string) {
    const campaignIds = await ownedCampaignIds(ownerId);
    const scope = { campaignId: { $in: campaignIds } };

    const [statusRows, totalLeads, pendingApproval, approved, outreachTotal, replied] =
      await Promise.all([
        LeadModel.aggregate<{ _id: LeadStatus; count: number }>([
          { $match: scope },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        LeadModel.countDocuments(scope),
        OutreachMessageModel.countDocuments({ ...scope, status: 'draft' }),
        OutreachMessageModel.countDocuments({ ...scope, status: 'approved' }),
        OutreachMessageModel.countDocuments({ ...scope, status: { $in: OUTREACH_DONE_STATUSES } }),
        LeadModel.countDocuments({ ...scope, status: 'replied' }),
      ]);

    const byStatus = Object.fromEntries(leadStatuses.map((status) => [status, 0])) as Record<
      LeadStatus,
      number
    >;

    for (const row of statusRows) {
      byStatus[row._id] = row.count;
    }

    const weekAgo = startOfDayUtc(7);
    const outreachThisWeek = await OutreachMessageModel.countDocuments({
      ...scope,
      status: { $in: OUTREACH_DONE_STATUSES },
      $or: [{ sentAt: { $gte: weekAgo } }, { approvedAt: { $gte: weekAgo } }],
    });

    const contacted = byStatus.contacted + byStatus.replied + byStatus.won + byStatus.lost;

    return {
      totalLeads,
      byStatus,
      pendingApproval,
      approved,
      sentTotal: outreachTotal,
      sentThisWeek: outreachThisWeek,
      replied,
      replyRate: outreachTotal > 0 ? Math.round((replied / outreachTotal) * 1000) / 10 : 0,
      funnel: [
        { stage: 'Discovered', count: totalLeads },
        {
          stage: 'Enriched',
          count:
            byStatus.enriched +
            byStatus.qualifying +
            byStatus.qualified +
            byStatus.drafting +
            contacted,
        },
        { stage: 'Qualified', count: byStatus.qualified + byStatus.drafting + contacted },
        { stage: 'Approved for outreach', count: contacted },
        { stage: 'Replied', count: byStatus.replied + byStatus.won + byStatus.lost },
        { stage: 'Won', count: byStatus.won },
      ],
    };
  },

  async timeseries(ownerId: string, days = 30) {
    const campaignIds = await ownedCampaignIds(ownerId);
    const since = startOfDayUtc(days - 1);

    const messages = await OutreachMessageModel.find({
      campaignId: { $in: campaignIds },
      status: { $in: OUTREACH_DONE_STATUSES },
    })
      .select('sentAt approvedAt')
      .lean();

    const counts = new Map<string, number>();

    for (const message of messages) {
      const at = outreachTimestamp(message);

      if (!at || at < since) {
        continue;
      }

      const key = at.toISOString().slice(0, 10);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    // Emit a dense series so the chart has no gaps.
    return Array.from({ length: days }, (_, index) => {
      const date = startOfDayUtc(days - 1 - index);
      const key = date.toISOString().slice(0, 10);
      return { date: key, sent: counts.get(key) ?? 0 };
    });
  },
};
