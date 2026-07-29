import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';

export const suppressionTypes = ['email', 'domain'] as const;
export type SuppressionType = (typeof suppressionTypes)[number];

export const suppressionReasons = [
  'unsubscribed',
  'bounced',
  'complained',
  'manual',
  'do_not_contact',
] as const;
export type SuppressionReason = (typeof suppressionReasons)[number];

export type Suppression = {
  type: SuppressionType;
  value: string;
  reason: SuppressionReason;
  note?: string;
  leadId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

type SuppressionModelType = Model<Suppression>;
export type SuppressionDocument = HydratedDocument<Suppression>;

const suppressionSchema = new Schema<Suppression, SuppressionModelType>(
  {
    type: { type: String, enum: suppressionTypes, required: true },
    value: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    reason: { type: String, enum: suppressionReasons, required: true },
    note: { type: String, maxlength: 500 },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
  },
  { timestamps: true },
);

suppressionSchema.index({ type: 1, value: 1 }, { unique: true });

export const SuppressionModel: SuppressionModelType =
  (mongoose.models.Suppression as SuppressionModelType) ??
  mongoose.model<Suppression, SuppressionModelType>('Suppression', suppressionSchema);
