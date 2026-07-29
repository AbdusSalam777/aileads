import { logger } from '../shared/logger.js';
import {
  JobRunModel,
  type JobName,
  type JobRunDocument,
  type JobTrigger,
} from '../features/jobs/job-run.model.js';

/** In-process guard so a slow run is never overlapped by the next tick. */
const running = new Set<JobName>();

export type JobStats = Record<string, number | string | undefined>;

export const isJobRunning = (name: JobName) => running.has(name);

export const runningJobs = (): JobName[] => [...running];

/**
 * Wraps every scheduled and manual job: overlap lock, JobRun record, timing and
 * error capture. A failing job records the failure and never crashes the process.
 */
export const runJob = async (
  name: JobName,
  trigger: JobTrigger,
  fn: () => Promise<JobStats>,
): Promise<JobRunDocument> => {
  if (running.has(name)) {
    logger.warn({ job: name }, 'Job already running, skipping this trigger');

    return JobRunModel.create({
      name,
      trigger,
      status: 'skipped',
      startedAt: new Date(),
      finishedAt: new Date(),
      durationMs: 0,
      stats: {},
      error: 'A previous run was still in progress',
    });
  }

  running.add(name);
  const startedAt = new Date();
  const run = await JobRunModel.create({ name, trigger, status: 'running', startedAt, stats: {} });

  try {
    const stats = await fn();
    const finishedAt = new Date();

    // JobRun.stats is typed as numbers; keep any string detail in `error` instead.
    const numericStats: Record<string, number> = {};
    let note: string | undefined;

    for (const [key, value] of Object.entries(stats)) {
      if (typeof value === 'number') {
        numericStats[key] = value;
      } else if (typeof value === 'string') {
        note = note ? `${note}; ${value}` : value;
      }
    }

    run.status = 'succeeded';
    run.finishedAt = finishedAt;
    run.durationMs = finishedAt.getTime() - startedAt.getTime();
    run.stats = numericStats;
    run.error = note;
    await run.save();

    logger.info({ job: name, trigger, stats: numericStats }, 'Job finished');
  } catch (error) {
    const finishedAt = new Date();
    run.status = 'failed';
    run.finishedAt = finishedAt;
    run.durationMs = finishedAt.getTime() - startedAt.getTime();
    run.error = error instanceof Error ? error.message : 'Unknown error';
    await run.save();

    logger.error({ error, job: name, trigger }, 'Job failed');
  } finally {
    running.delete(name);
  }

  return run;
};
