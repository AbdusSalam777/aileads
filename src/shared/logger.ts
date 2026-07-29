import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: 'ai-leads-api',
    environment: env.NODE_ENV,
  },
  redact: [
    'req.headers.authorization',
    'password',
    'token',
    '*.password',
    '*.token',
    'apiKey',
    '*.apiKey',
    'GROQ_API_KEY',
    'SMTP_PASSWORD',
    'IMAP_PASSWORD',
    'UNSUBSCRIBE_SECRET',
    'REDDIT_CLIENT_SECRET',
  ],
});
