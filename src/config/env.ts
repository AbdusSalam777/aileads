import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const currentDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(currentDir, '../../.env') });

const devAccessSecret = 'development-access-secret-change-before-production';
const devRefreshSecret = 'development-refresh-secret-change-before-production';
const devUnsubscribeSecret = 'development-unsubscribe-secret-change-before-production';

const booleanFlag = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((value) => value === 'true');

const csvList = <T extends string>(allowed: readonly T[], defaultValue: string) =>
  z
    .string()
    .default(defaultValue)
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0),
    )
    .pipe(z.array(z.enum(allowed as unknown as [T, ...T[]])));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  API_PREFIX: z.string().default('/api/v1'),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  MONGODB_URI: z.string().optional().default('mongodb://127.0.0.1:27017/ai_leads'),
  REDIS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_TLS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JWT_ACCESS_SECRET: z.string().min(32).default(devAccessSecret),
  JWT_REFRESH_SECRET: z.string().min(32).default(devRefreshSecret),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  AUTH_COOKIE_DOMAIN: z.string().optional(),

  // --- Public / general ---
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:5000'),
  SCHEDULER_ENABLED: booleanFlag('false'),
  TIMEZONE: z.string().default('UTC'),

  // --- Dry run (PIPELINE_DRY_RUN is a master switch over the other two) ---
  PIPELINE_DRY_RUN: booleanFlag('false'),
  AI_DRY_RUN: booleanFlag('false'),
  DISCOVERY_DRY_RUN: booleanFlag('false'),

  // --- Discovery (shared) ---
  // There is no send capacity to pace against any more, so this is bounded
  // only by what a polite daily sweep of Overpass can return — see osm.source.ts.
  DISCOVERY_DAILY_LEAD_TARGET: z.coerce.number().int().positive().max(500).default(300),
  INTENT_SOURCES: csvList(['hn', 'remoteok', 'wwr', 'reddit'] as const, 'hn,remoteok,wwr'),
  INTENT_MAX_AGE_HOURS: z.coerce.number().int().positive().default(72),
  HTTP_CONTACT_EMAIL: z.string().optional(),

  // --- Reddit (optional intent source; free app registration, no card) ---
  REDDIT_CLIENT_ID: z.string().optional(),
  REDDIT_CLIENT_SECRET: z.string().optional(),

  // --- OpenStreetMap Overpass (fit-based backfill) ---
  OVERPASS_ENDPOINT: z.string().url().default('https://overpass-api.de/api/interpreter'),
  OVERPASS_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
  OVERPASS_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  OVERPASS_CACHE_TTL_HOURS: z.coerce.number().int().positive().default(24),
  // Raised alongside the daily target so a bigger city's results are not cut
  // off mid-response — request count stays bounded by the number of areas
  // configured, not by this number.
  OVERPASS_MAX_RESULTS: z.coerce.number().int().positive().max(1000).default(400),

  // --- Scraper ---
  SCRAPE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  SCRAPE_MAX_BYTES: z.coerce.number().int().positive().default(500_000),
  // More contact/about pages visited per site directly raises the share of
  // leads that come back with a usable email address.
  SCRAPE_MAX_PAGES_PER_SITE: z.coerce.number().int().positive().max(10).default(5),
  SCRAPE_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  SCRAPE_USER_AGENT: z.string().default('ai-leads-outreach/0.1'),
  ENRICH_BATCH_SIZE: z.coerce.number().int().positive().max(50).default(20),

  // --- AI ---
  AI_PROVIDER: z.enum(['groq', 'ollama', 'stub']).default('groq'),
  AI_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(3000),
  AI_MAX_RETRIES: z.coerce.number().int().positive().max(10).default(3),
  AI_BATCH_SIZE: z.coerce.number().int().positive().max(50).default(10),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  GROQ_API_KEY: z.string().optional(),
  GROQ_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  OLLAMA_BASE_URL: z.string().url().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().default('llama3.1:8b'),

  // --- IMAP (reply detection only; this app never sends email itself) ---
  IMAP_ENABLED: booleanFlag('false'),
  IMAP_HOST: z.string().default('imap.gmail.com'),
  IMAP_PORT: z.coerce.number().int().positive().default(993),
  IMAP_USER: z.string().optional(),
  IMAP_PASSWORD: z.string().optional(),
  IMAP_POLL_MINUTES: z.coerce.number().int().positive().default(10),
  IMAP_MAX_STALE_HOURS: z.coerce.number().int().positive().default(24),

  // --- Compliance ---
  UNSUBSCRIBE_SECRET: z.string().min(32).default(devUnsubscribeSecret),
  SENDER_PHYSICAL_ADDRESS: z.string().optional(),
}).superRefine((value, ctx) => {
  const aiDryRun = value.PIPELINE_DRY_RUN || value.AI_DRY_RUN;

  if (value.AI_PROVIDER === 'groq' && !aiDryRun && !value.GROQ_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['GROQ_API_KEY'],
      message: 'GROQ_API_KEY is required when AI_PROVIDER=groq and AI_DRY_RUN is false',
    });
  }

  if (value.INTENT_SOURCES.includes('reddit') && !(value.REDDIT_CLIENT_ID && value.REDDIT_CLIENT_SECRET)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['REDDIT_CLIENT_ID'],
      message: 'REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are required when "reddit" is in INTENT_SOURCES',
    });
  }

  if (value.IMAP_ENABLED && !(value.IMAP_USER && value.IMAP_PASSWORD)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['IMAP_USER'],
      message: 'IMAP_USER and IMAP_PASSWORD are required when IMAP_ENABLED is true',
    });
  }

  if (value.NODE_ENV !== 'production') {
    return;
  }

  // Every exported email still carries this app's unsubscribe link and postal
  // address, whatever tool actually sends it — so these stay mandatory in
  // production regardless of how outreach happens.
  if (!value.SENDER_PHYSICAL_ADDRESS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SENDER_PHYSICAL_ADDRESS'],
      message: 'SENDER_PHYSICAL_ADDRESS is legally required — it appears in every exported email',
    });
  }

  if (value.UNSUBSCRIBE_SECRET === devUnsubscribeSecret) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['UNSUBSCRIBE_SECRET'],
      message: 'UNSUBSCRIBE_SECRET must be changed before exporting real outreach in production',
    });
  }

  if (value.PUBLIC_BASE_URL.includes('localhost')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['PUBLIC_BASE_URL'],
      message: 'PUBLIC_BASE_URL must be publicly reachable so unsubscribe links work',
    });
  }

  if (!value.MONGODB_URI) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MONGODB_URI'],
      message: 'MONGODB_URI is required in production',
    });
  }

  if (value.JWT_ACCESS_SECRET === devAccessSecret) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_ACCESS_SECRET'],
      message: 'JWT_ACCESS_SECRET must be changed in production',
    });
  }

  if (value.JWT_REFRESH_SECRET === devRefreshSecret) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_REFRESH_SECRET'],
      message: 'JWT_REFRESH_SECRET must be changed in production',
    });
  }
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const message = parsedEnv.error.issues.map((issue) => issue.message).join(', ');
  throw new Error(`Invalid environment configuration: ${message}`);
}

const parsed = parsedEnv.data;

// PIPELINE_DRY_RUN is a master switch: it forces every individual dry-run flag on.
export const env = {
  ...parsed,
  AI_DRY_RUN: parsed.PIPELINE_DRY_RUN || parsed.AI_DRY_RUN,
  DISCOVERY_DRY_RUN: parsed.PIPELINE_DRY_RUN || parsed.DISCOVERY_DRY_RUN,
};

export const userAgent = parsed.HTTP_CONTACT_EMAIL
  ? `${parsed.SCRAPE_USER_AGENT} (+${parsed.HTTP_CONTACT_EMAIL})`
  : parsed.SCRAPE_USER_AGENT;
