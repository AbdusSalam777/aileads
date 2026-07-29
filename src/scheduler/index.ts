import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';
import { discoveryService } from '../features/discovery/discovery.service.js';
import { draftingService } from '../features/drafting/drafting.service.js';
import { inboxService } from '../features/email/inbox.service.js';
import { enrichmentService } from '../features/enrichment/enrichment.service.js';
import type { JobName } from '../features/jobs/job-run.model.js';
import { followUpService } from '../features/outreach/follow-up.service.js';
import { senderService } from '../features/outreach/sender.service.js';
import { qualificationService } from '../features/qualification/qualification.service.js';
import { runJob, type JobStats } from './run-job.js';

export type JobDefinition = {
  name: JobName;
  cron: string;
  description: string;
  run: () => Promise<JobStats>;
};

export const jobDefinitions: JobDefinition[] = [
  {
    name: 'discovery',
    cron: '0 6 * * *',
    description: 'Find new leads: intent sources first, OSM backfill after',
    run: () => discoveryService.runDiscovery() as Promise<JobStats>,
  },
  {
    name: 'enrichment',
    cron: '*/10 * * * *',
    description: 'Scrape sites to find contact details and sales signals',
    run: () => enrichmentService.runEnrichment() as Promise<JobStats>,
  },
  {
    name: 'qualification',
    cron: '*/15 * * * *',
    description: 'Score enriched leads with the AI provider',
    run: () => qualificationService.runQualification() as Promise<JobStats>,
  },
  {
    name: 'drafting',
    cron: '*/20 * * * *',
    description: 'Draft outreach for qualified leads (awaits human approval)',
    run: () => draftingService.runDrafting() as Promise<JobStats>,
  },
  {
    name: 'send',
    cron: '*/5 * * * *',
    description: 'Send at most one approved message, subject to every gate',
    run: () => senderService.runSendCycle() as Promise<JobStats>,
  },
  {
    name: 'reply_poll',
    cron: `*/${env.IMAP_POLL_MINUTES} * * * *`,
    description: 'Check the inbox for replies and bounces',
    run: () => inboxService.runReplyPoll() as Promise<JobStats>,
  },
  {
    name: 'follow_up_scan',
    cron: '30 7 * * *',
    description: 'Queue follow-ups for leads that never replied',
    run: () => followUpService.runFollowUpScan() as Promise<JobStats>,
  },
];

const tasks: ScheduledTask[] = [];

export const getJobDefinition = (name: JobName) =>
  jobDefinitions.find((definition) => definition.name === name);

export const startScheduler = () => {
  if (!env.SCHEDULER_ENABLED) {
    logger.warn('SCHEDULER_ENABLED is false; no jobs will run automatically');
    return;
  }

  for (const definition of jobDefinitions) {
    const task = cron.schedule(
      definition.cron,
      () => {
        void runJob(definition.name, 'cron', definition.run);
      },
      { timezone: env.TIMEZONE, name: definition.name, noOverlap: true },
    );

    tasks.push(task);
  }

  logger.info(
    { jobs: jobDefinitions.map((d) => `${d.name}@${d.cron}`), timezone: env.TIMEZONE },
    'Scheduler started',
  );
};

export const stopScheduler = async () => {
  await Promise.all(tasks.map((task) => Promise.resolve(task.stop())));
  tasks.length = 0;
  logger.info('Scheduler stopped');
};

export const isSchedulerRunning = () => tasks.length > 0;
