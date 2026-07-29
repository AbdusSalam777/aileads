import { Redis } from 'ioredis';
import { env } from './env.js';

export const redisOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  tls: env.REDIS_TLS ? {} : undefined,
  maxRetriesPerRequest: null,
};

let redisConnection: Redis | null = null;

export const getRedisConnection = () => {
  if (!env.REDIS_ENABLED) {
    return null;
  }

  redisConnection ??= new Redis(redisOptions);
  return redisConnection;
};

export const closeRedis = async () => {
  if (!redisConnection) {
    return;
  }

  await redisConnection.quit();
};
