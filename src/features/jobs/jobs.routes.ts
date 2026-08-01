import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { authenticate } from '../../middleware/authenticate.js';
import { ApiError } from '../../shared/api-error.js';
import { sendSuccess } from '../../shared/api-response.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { validateRequest } from '../../shared/validate-request.js';
import { getJobDefinition, isSchedulerRunning, jobDefinitions } from '../../scheduler/index.js';
import { runJob, runningJobs } from '../../scheduler/run-job.js';
import { getLastPollAt, isReplyDetectionHealthy } from '../email/inbox.service.js';
import { JobRunModel, jobNames } from './job-run.model.js';

const runSchema = z.object({ params: z.object({ name: z.enum(jobNames) }) });

const listSchema = z.object({
  query: z.object({
    name: z.enum(jobNames).optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  }),
});

export const jobsRouter = Router();

jobsRouter.use(authenticate);

jobsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const active = runningJobs();

    const jobs = await Promise.all(
      jobDefinitions.map(async (definition) => {
        const lastRun = await JobRunModel.findOne({ name: definition.name })
          .sort({ startedAt: -1 })
          .lean();

        return {
          name: definition.name,
          cron: definition.cron,
          description: definition.description,
          running: active.includes(definition.name),
          lastRun: lastRun ?? null,
        };
      }),
    );

    sendSuccess(res, {
      data: {
        schedulerEnabled: env.SCHEDULER_ENABLED,
        schedulerRunning: isSchedulerRunning(),
        timezone: env.TIMEZONE,
        dryRun: {
          ai: env.AI_DRY_RUN,
          discovery: env.DISCOVERY_DRY_RUN,
        },
        aiProvider: env.AI_PROVIDER,
        imap: {
          enabled: env.IMAP_ENABLED,
          healthy: isReplyDetectionHealthy(),
          lastPollAt: getLastPollAt() ?? null,
        },
        jobs,
      },
    });
  }),
);

jobsRouter.get(
  '/runs',
  validateRequest(listSchema),
  asyncHandler(async (req, res) => {
    const filter = req.query.name ? { name: req.query.name } : {};
    const runs = await JobRunModel.find(filter)
      .sort({ startedAt: -1 })
      .limit(Number(req.query.limit ?? 25))
      .lean();

    sendSuccess(res, { data: runs });
  }),
);

jobsRouter.post(
  '/:name/run',
  validateRequest(runSchema),
  asyncHandler(async (req, res) => {
    const definition = getJobDefinition(req.params.name as never);

    if (!definition) {
      throw new ApiError(404, 'Unknown job', 'JOB_NOT_FOUND');
    }

    // Manual triggers reuse the exact cron path, so the UI can never diverge.
    const run = await runJob(definition.name, 'manual', definition.run);
    sendSuccess(res, { message: `Job "${definition.name}" finished`, data: run });
  }),
);
