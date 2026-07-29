import { Queue, Worker } from 'bullmq';
import { env } from '../config/env.js';
import { redisOptions } from '../config/redis.js';
import { logger } from '../shared/logger.js';

export const queueNames = {
  leadDiscovery: 'lead-discovery',
  enrichment: 'enrichment',
  email: 'email',
} as const;

type QueueName = (typeof queueNames)[keyof typeof queueNames];

const queues = new Map<QueueName, Queue>();
const workers = new Map<QueueName, Worker>();

export const initializeQueues = () => {
  if (!env.REDIS_ENABLED) {
    logger.warn('REDIS_ENABLED is false. BullMQ queues are disabled for this process.');
    return;
  }

  Object.values(queueNames).forEach((name) => {
    queues.set(name, new Queue(name, { connection: redisOptions }));
  });

  logger.info({ queues: Object.values(queueNames) }, 'BullMQ queues initialized');
};

export const getQueue = (name: QueueName) => {
  const queue = queues.get(name);

  if (!queue) {
    throw new Error(`Queue "${name}" has not been initialized. Check REDIS_ENABLED.`);
  }

  return queue;
};

export const registerWorker = (name: QueueName, worker: Worker) => {
  workers.set(name, worker);
};

export const closeQueues = async () => {
  await Promise.all([...workers.values()].map((worker) => worker.close()));
  await Promise.all([...queues.values()].map((queue) => queue.close()));
};
