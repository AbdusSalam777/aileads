import mongoose, { Schema, type HydratedDocument, type Model } from 'mongoose';

export const jobNames = [
  'discovery',
  'enrichment',
  'qualification',
  'drafting',
  'reply_poll',
] as const;
export type JobName = (typeof jobNames)[number];

export const jobTriggers = ['cron', 'manual', 'script'] as const;
export type JobTrigger = (typeof jobTriggers)[number];

export const jobStatuses = ['running', 'succeeded', 'failed', 'skipped'] as const;
export type JobStatus = (typeof jobStatuses)[number];

export type JobRun = {
  name: JobName;
  trigger: JobTrigger;
  status: JobStatus;
  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
  stats: Record<string, number>;
  error?: string;
  /** Used to skip repeat work (e.g. an identical Overpass query inside the cache TTL). */
  dedupeKey?: string;
  createdAt: Date;
  updatedAt: Date;
};

type JobRunModelType = Model<JobRun>;
export type JobRunDocument = HydratedDocument<JobRun>;

const jobRunSchema = new Schema<JobRun, JobRunModelType>(
  {
    name: { type: String, enum: jobNames, required: true, index: true },
    trigger: { type: String, enum: jobTriggers, required: true },
    status: { type: String, enum: jobStatuses, default: 'running', index: true },
    startedAt: { type: Date, required: true },
    finishedAt: Date,
    durationMs: Number,
    stats: { type: Schema.Types.Mixed, default: {} },
    error: { type: String, maxlength: 2000 },
    dedupeKey: { type: String, index: true },
  },
  { timestamps: true },
);

jobRunSchema.index({ name: 1, startedAt: -1 });
jobRunSchema.index({ dedupeKey: 1, status: 1, startedAt: -1 });

export const JobRunModel: JobRunModelType =
  (mongoose.models.JobRun as JobRunModelType) ??
  mongoose.model<JobRun, JobRunModelType>('JobRun', jobRunSchema);
