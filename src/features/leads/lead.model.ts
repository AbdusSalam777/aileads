import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';

export const leadStatuses = [
  'discovered',
  'enriching',
  'enriched',
  'qualifying',
  'qualified',
  'drafting',
  'contacted',
  'replied',
  'won',
  'lost',
  'unreachable',
  'disqualified',
  'manual_action',
  'unsubscribed',
  'bounced',
  'do_not_contact',
] as const;
export type LeadStatus = (typeof leadStatuses)[number];

export const leadSources = ['hn', 'remoteok', 'wwr', 'reddit', 'osm', 'manual'] as const;
export type LeadSource = (typeof leadSources)[number];

export const leadSourceKinds = ['intent', 'fit'] as const;
export type LeadSourceKind = (typeof leadSourceKinds)[number];

/** How we can actually reach this lead. `manual` means no email exists — a human must apply via the source link. */
export const contactChannels = ['email', 'manual', 'unknown'] as const;
export type ContactChannel = (typeof contactChannels)[number];

export const leadTiers = ['hot', 'warm', 'cold'] as const;
export type LeadTier = (typeof leadTiers)[number];

export type IntentPayload = {
  title: string;
  excerpt: string;
  budgetText?: string;
  tags: string[];
  signalScore: number;
  signals: string[];
};

export type SiteContext = {
  fetchedAt: Date;
  finalUrl?: string;
  statusCode?: number;
  title?: string;
  description?: string;
  excerpt?: string;
  techSignals: string[];
  emailsFound: string[];
  hasViewport: boolean;
  hasHttps: boolean;
  hasVideo: boolean;
  copyrightYear?: number;
};

export type LeadAiAssessment = {
  score: number;
  tier: LeadTier;
  reasons: string[];
  personalizationHooks: string[];
  serviceFit: string[];
  model: string;
  qualifiedAt: Date;
};

export type LeadStatusChange = {
  from: LeadStatus;
  to: LeadStatus;
  reason?: string;
  at: Date;
};

export type LeadNote = {
  body: string;
  authorId?: Types.ObjectId;
  at: Date;
};

/**
 * A snippet of what a lead wrote back, shown next to the email that prompted it.
 * Only an excerpt is kept — the operator's mailbox remains the real record of
 * the conversation, and this exists purely to give the reply context in-app.
 */
export type LeadReply = {
  fromEmail: string;
  subject?: string;
  snippet: string;
  receivedAt: Date;
};

export type Lead = {
  campaignId: Types.ObjectId;
  source: LeadSource;
  sourceKind: LeadSourceKind;
  externalId: string;
  sourceUrl?: string;
  postedAt?: Date;

  name: string;
  company?: string;
  websiteUrl?: string;
  location?: string;
  category?: string;

  intent?: IntentPayload;
  osmTags?: Record<string, string>;

  contactChannel: ContactChannel;
  contactEmail?: string;
  contactEmailConfidence: number;
  contactNote?: string;

  site?: SiteContext;
  enrichmentError?: string;
  enrichmentAttempts: number;

  ai?: LeadAiAssessment;

  status: LeadStatus;
  statusHistory: LeadStatusChange[];
  sequenceStep: number;
  lastContactedAt?: Date;
  nextFollowUpAt?: Date | null;
  repliedAt?: Date;
  replies: LeadReply[];
  notes: LeadNote[];

  createdAt: Date;
  updatedAt: Date;
};

type LeadModelType = Model<Lead>;
export type LeadDocument = HydratedDocument<Lead>;

const intentSchema = new Schema<IntentPayload>(
  {
    title: { type: String, default: '', maxlength: 500 },
    excerpt: { type: String, default: '', maxlength: 4000 },
    budgetText: { type: String, maxlength: 200 },
    tags: { type: [String], default: [] },
    signalScore: { type: Number, default: 0 },
    signals: { type: [String], default: [] },
  },
  { _id: false },
);

const siteSchema = new Schema<SiteContext>(
  {
    fetchedAt: { type: Date, required: true },
    finalUrl: String,
    statusCode: Number,
    title: { type: String, maxlength: 500 },
    description: { type: String, maxlength: 1000 },
    excerpt: { type: String, maxlength: 4000 },
    techSignals: { type: [String], default: [] },
    emailsFound: { type: [String], default: [] },
    hasViewport: { type: Boolean, default: false },
    hasHttps: { type: Boolean, default: false },
    hasVideo: { type: Boolean, default: false },
    copyrightYear: Number,
  },
  { _id: false },
);

const aiSchema = new Schema<LeadAiAssessment>(
  {
    score: { type: Number, required: true, min: 0, max: 100 },
    tier: { type: String, enum: leadTiers, required: true },
    reasons: { type: [String], default: [] },
    personalizationHooks: { type: [String], default: [] },
    serviceFit: { type: [String], default: [] },
    model: { type: String, default: '' },
    qualifiedAt: { type: Date, required: true },
  },
  { _id: false },
);

const statusChangeSchema = new Schema<LeadStatusChange>(
  {
    from: { type: String, enum: leadStatuses, required: true },
    to: { type: String, enum: leadStatuses, required: true },
    reason: { type: String, maxlength: 500 },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const noteSchema = new Schema<LeadNote>(
  {
    body: { type: String, required: true, maxlength: 2000 },
    authorId: { type: Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const leadReplySchema = new Schema<LeadReply>(
  {
    fromEmail: { type: String, required: true, trim: true, lowercase: true, maxlength: 320 },
    subject: { type: String, trim: true, maxlength: 300 },
    snippet: { type: String, required: true, maxlength: 2000 },
    receivedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const leadSchema = new Schema<Lead, LeadModelType>(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    source: { type: String, enum: leadSources, required: true, index: true },
    sourceKind: { type: String, enum: leadSourceKinds, required: true },
    externalId: { type: String, required: true },
    sourceUrl: { type: String, maxlength: 1000 },
    postedAt: Date,

    name: { type: String, required: true, trim: true, maxlength: 300 },
    company: { type: String, trim: true, maxlength: 300 },
    websiteUrl: { type: String, trim: true, maxlength: 1000 },
    location: { type: String, trim: true, maxlength: 200 },
    category: { type: String, trim: true, maxlength: 120 },

    intent: intentSchema,
    osmTags: { type: Map, of: String },

    contactChannel: { type: String, enum: contactChannels, default: 'unknown', index: true },
    contactEmail: { type: String, trim: true, lowercase: true, maxlength: 254, index: true },
    contactEmailConfidence: { type: Number, default: 0, min: 0, max: 1 },
    contactNote: { type: String, maxlength: 500 },

    site: siteSchema,
    enrichmentError: { type: String, maxlength: 1000 },
    enrichmentAttempts: { type: Number, default: 0 },

    ai: aiSchema,

    status: { type: String, enum: leadStatuses, default: 'discovered', index: true },
    statusHistory: { type: [statusChangeSchema], default: [] },
    sequenceStep: { type: Number, default: 0 },
    lastContactedAt: Date,
    nextFollowUpAt: { type: Date, default: null },
    repliedAt: Date,
    replies: { type: [leadReplySchema], default: [] },
    notes: { type: [noteSchema], default: [] },
  },
  { timestamps: true },
);

// Makes re-running discovery idempotent instead of duplicating leads.
leadSchema.index({ campaignId: 1, source: 1, externalId: 1 }, { unique: true });
leadSchema.index({ campaignId: 1, status: 1, updatedAt: -1 });
leadSchema.index({ status: 1, updatedAt: 1 });
leadSchema.index({ nextFollowUpAt: 1 });
leadSchema.index({ 'ai.score': -1 });

export const LeadModel: LeadModelType =
  (mongoose.models.Lead as LeadModelType) ?? mongoose.model<Lead, LeadModelType>('Lead', leadSchema);
