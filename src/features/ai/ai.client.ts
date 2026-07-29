import type { z } from 'zod';
import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';
import { createSpacedRunner } from '../../shared/rate-limiter.js';
import { sleep } from '../../shared/sleep.js';
import { AiError, type AiProvider, type ChatRequest } from './ai.types.js';
import { groqProvider } from './groq.provider.js';
import { ollamaProvider } from './ollama.provider.js';
import { stubProvider } from './stub.provider.js';

// Free tiers are rate limited per minute; serialise and space every call.
const runSpaced = createSpacedRunner(env.AI_MIN_INTERVAL_MS);

export const getProvider = (): AiProvider => {
  if (env.AI_DRY_RUN) {
    return stubProvider;
  }

  switch (env.AI_PROVIDER) {
    case 'ollama':
      return ollamaProvider;
    case 'stub':
      return stubProvider;
    default:
      return groqProvider;
  }
};

/**
 * Models sometimes wrap JSON in prose or fences despite being asked not to.
 * Pull out the outermost JSON object rather than failing the whole call.
 */
export const extractJson = (text: string): string | undefined => {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();

  if (candidate.startsWith('{') && candidate.endsWith('}')) {
    return candidate;
  }

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');

  return start !== -1 && end > start ? candidate.slice(start, end + 1) : undefined;
};

export type ChatJsonResult<T> = {
  data: T;
  model: string;
};

/**
 * Calls the model and validates its JSON against a Zod schema. A response that
 * does not match is retried; if it never matches we throw rather than let
 * malformed content reach a draft.
 */
export const chatJson = async <T>(
  request: ChatRequest,
  schema: z.ZodType<T>,
): Promise<ChatJsonResult<T>> => {
  const provider = getProvider();
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= env.AI_MAX_RETRIES; attempt += 1) {
    try {
      const result = await runSpaced(() => provider.chat(request));
      const json = extractJson(result.text);

      if (!json) {
        lastError = new Error('Model response contained no JSON object');
        logger.warn({ attempt, provider: provider.name }, 'AI response had no JSON');
        continue;
      }

      const parsed = schema.safeParse(JSON.parse(json));

      if (!parsed.success) {
        lastError = new Error(`Model output failed validation: ${parsed.error.message}`);
        logger.warn(
          { attempt, provider: provider.name, issues: parsed.error.issues.slice(0, 3) },
          'AI output failed schema validation',
        );
        continue;
      }

      return { data: parsed.data, model: result.model };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown AI error');

      if (error instanceof AiError && !error.retryable) {
        logger.error({ error, provider: provider.name }, 'AI call failed permanently');
        throw error;
      }

      const backoffMs =
        error instanceof AiError && error.retryAfterMs
          ? error.retryAfterMs
          : attempt * env.AI_MIN_INTERVAL_MS * 2;

      logger.warn({ attempt, backoffMs, provider: provider.name }, 'AI call failed, retrying');

      if (attempt < env.AI_MAX_RETRIES) {
        await sleep(backoffMs);
      }
    }
  }

  throw new AiError(
    `AI call failed after ${env.AI_MAX_RETRIES} attempts: ${lastError?.message ?? 'unknown'}`,
    false,
  );
};
