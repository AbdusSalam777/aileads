import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';

export const messageKinds = ['initial', 'followup_1', 'followup_2'] as const;
export type MessageKind = (typeof messageKinds)[number];

export const messageStatuses = [
  'draft',
  'approved',
  'sending',
  'sent',
  'failed',
  'cancelled',
] as const;
export type MessageStatus = (typeof messageStatuses)[number];

export const kindForStep = (step: number): MessageKind =>
  step <= 0 ? 'initial' : step === 1 ? 'followup_1' : 'followup_2';

export type OutreachMessage = {
  leadId: Types.ObjectId;
  campaignId: Types.ObjectId;
  kind: MessageKind;
  status: MessageStatus;

  toEmail: string;
  subject: string;
  body: string;

  /** Kept verbatim so the UI can show whether a human edited the AI's draft. */
  aiSubject?: string;
  aiBody?: string;
  aiModel?: string;
  validationIssues: string[];

  unsubscribeToken: string;

  scheduledFor?: Date | null;
  approvedAt?: Date;
  approvedBy?: Types.ObjectId;
  sentAt?: Date;
  messageId?: string;
  smtpResponse?: string;
  failureReason?: string;
  attempts: number;
  dryRun: boolean;

  createdAt: Date;
  updatedAt: Date;
};

type OutreachMessageModelType = Model<OutreachMessage>;
export type OutreachMessageDocument = HydratedDocument<OutreachMessage>;

const outreachMessageSchema = new Schema<OutreachMessage, OutreachMessageModelType>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    kind: { type: String, enum: messageKinds, required: true },
    status: { type: String, enum: messageStatuses, default: 'draft', index: true },

    toEmail: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    subject: { type: String, required: true, trim: true, maxlength: 300 },
    body: { type: String, required: true, maxlength: 10_000 },

    aiSubject: { type: String, maxlength: 300 },
    aiBody: { type: String, maxlength: 10_000 },
    aiModel: String,
    validationIssues: { type: [String], default: [] },

    unsubscribeToken: { type: String, required: true },

    scheduledFor: { type: Date, default: null, index: true },
    approvedAt: Date,
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    sentAt: Date,
    messageId: String,
    smtpResponse: { type: String, maxlength: 1000 },
    failureReason: { type: String, maxlength: 1000 },
    attempts: { type: Number, default: 0 },
    dryRun: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// One message per lead per sequence step — prevents duplicate drafts and double sends.
outreachMessageSchema.index({ leadId: 1, kind: 1 }, { unique: true });
outreachMessageSchema.index({ status: 1, scheduledFor: 1 });
outreachMessageSchema.index({ campaignId: 1, status: 1, updatedAt: -1 });
outreachMessageSchema.index({ sentAt: -1 });

export const OutreachMessageModel: OutreachMessageModelType =
  (mongoose.models.OutreachMessage as OutreachMessageModelType) ??
  mongoose.model<OutreachMessage, OutreachMessageModelType>(
    'OutreachMessage',
    outreachMessageSchema,
  );
