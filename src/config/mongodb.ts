import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../shared/logger.js';

export const isMongoConfigured = () => Boolean(env.MONGODB_URI);

export const connectMongo = async () => {
  if (!isMongoConfigured()) {
    logger.warn('MONGODB_URI is not configured. Database-backed routes are disabled.');
    return;
  }

  mongoose.set('strictQuery', true);

  await mongoose.connect(env.MONGODB_URI, {
    autoIndex: env.NODE_ENV !== 'production',
  });

  logger.info('MongoDB connected');
};

export const disconnectMongo = async () => {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
};
