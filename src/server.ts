import { createServer } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { connectMongo, disconnectMongo } from './config/mongodb.js';
import { closeRedis } from './config/redis.js';
import { senderService } from './features/outreach/sender.service.js';
import { closeQueues, initializeQueues } from './queues/index.js';
import { startScheduler, stopScheduler } from './scheduler/index.js';
import { logger } from './shared/logger.js';

const server = createServer(app);

const startServer = async () => {
  await connectMongo();
  initializeQueues();

  // A crash or dev-server restart can strand a message mid-send; fail those
  // rather than risk sending the same email twice.
  await senderService.resetStaleSending();
  startScheduler();

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'API server listening');
  });
};

const shutdown = async (signal: NodeJS.Signals) => {
  logger.info({ signal }, 'Shutdown signal received');
  server.close(async () => {
    await stopScheduler();
    await closeQueues();
    await closeRedis();
    await disconnectMongo();
    logger.info('Shutdown complete');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

startServer().catch((error) => {
  logger.fatal({ error }, 'Failed to start API server');
  process.exit(1);
});
