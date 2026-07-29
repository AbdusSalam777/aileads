import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';

export const campaignStatuses = ['draft', 'active', 'paused', 'archived'] as const;
export type CampaignStatus = (typeof campaignStatuses)[number];

export const intentSourceNames = ['hn', 'remoteok', 'wwr', 'reddit'] as const;
export type IntentSourceName = (typeof intentSourceNames)[number];

export type SenderIdentity = {
  name: string;
  email: string;
  title?: string;
  company?: string;
  /** Legally required in the footer of every outreach email (CAN-SPAM). */
  physicalAddress?: string;
  portfolioUrl?: string;
  calendarUrl?: string;
};

export type OsmTargeting = {
  areas: string[];
  categories: string[];
};

export type SendingConfig = {
  dailyCap: number;
  minSpacingMinutes: number;
  maxSpacingMinutes: number;
  startHour: number;
  endHour: number;
  days: number[];
  timezone: string;
};

export type FollowUpConfig = {
  enabled: boolean;
  maxSteps: number;
  delayDays: number[];
};

export type Campaign = {
  ownerId: Types.ObjectId;
  name: string;
  status: CampaignStatus;
  services: string[];
  offer: string;
  icp: string;
  sender: SenderIdentity;
  intentEnabled: boolean;
  intentSources: IntentSourceName[];
  intentKeywords: string[];
  osmEnabled: boolean;
  osmTargeting: OsmTargeting;
  sending: SendingConfig;
  followUp: FollowUpConfig;
  minScoreToDraft: number;
  dailyLeadTarget: number;
  createdAt: Date;
  updatedAt: Date;
};

type CampaignModelType = Model<Campaign>;
export type CampaignDocument = HydratedDocument<Campaign>;

const senderSchema = new Schema<SenderIdentity>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    title: { type: String, trim: true, maxlength: 120 },
    company: { type: String, trim: true, maxlength: 120 },
    physicalAddress: { type: String, trim: true, maxlength: 300 },
    portfolioUrl: { type: String, trim: true, maxlength: 500 },
    calendarUrl: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

const sendingSchema = new Schema<SendingConfig>(
  {
    dailyCap: { type: Number, default: 8, min: 1, max: 50 },
    minSpacingMinutes: { type: Number, default: 45, min: 1 },
    maxSpacingMinutes: { type: Number, default: 180, min: 1 },
    startHour: { type: Number, default: 9, min: 0, max: 23 },
    endHour: { type: Number, default: 17, min: 1, max: 24 },
    days: { type: [Number], default: [1, 2, 3, 4, 5] },
    timezone: { type: String, default: 'UTC' },
  },
  { _id: false },
);

const followUpSchema = new Schema<FollowUpConfig>(
  {
    enabled: { type: Boolean, default: true },
    maxSteps: { type: Number, default: 2, min: 0, max: 2 },
    delayDays: { type: [Number], default: [4, 7] },
  },
  { _id: false },
);

const osmTargetingSchema = new Schema<OsmTargeting>(
  {
    areas: { type: [String], default: [] },
    categories: { type: [String], default: [] },
  },
  { _id: false },
);

const campaignSchema = new Schema<Campaign, CampaignModelType>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    status: { type: String, enum: campaignStatuses, default: 'draft', index: true },
    services: { type: [String], default: [] },
    offer: { type: String, default: '', maxlength: 2000 },
    icp: { type: String, default: '', maxlength: 2000 },
    sender: { type: senderSchema, required: true },
    intentEnabled: { type: Boolean, default: true },
    intentSources: { type: [String], enum: intentSourceNames, default: ['hn', 'remoteok', 'wwr'] },
    intentKeywords: { type: [String], default: [] },
    osmEnabled: { type: Boolean, default: false },
    osmTargeting: { type: osmTargetingSchema, default: () => ({ areas: [], categories: [] }) },
    sending: { type: sendingSchema, default: () => ({}) },
    followUp: { type: followUpSchema, default: () => ({}) },
    minScoreToDraft: { type: Number, default: 60, min: 0, max: 100 },
    dailyLeadTarget: { type: Number, default: 40, min: 1, max: 500 },
  },
  { timestamps: true },
);

campaignSchema.index({ ownerId: 1, status: 1 });

export const CampaignModel: CampaignModelType =
  (mongoose.models.Campaign as CampaignModelType) ??
  mongoose.model<Campaign, CampaignModelType>('Campaign', campaignSchema);
