import { env } from '../../config/env.js';
import { fetchText } from '../../shared/http-fetch.js';
import { AiError, type AiProvider, type ChatRequest } from './ai.types.js';

type ChatCompletion = {
  choices?: Array<{ message?: { content?: string } }>;
  model?: string;
  error?: { message?: string; code?: string };
};

/** Groq is OpenAI wire-compatible, so plain fetch is enough — no SDK needed. */
export const groqProvider: AiProvider = {
  name: 'groq',
  model: env.GROQ_MODEL,

  async chat(request: ChatRequest) {
    if (!env.GROQ_API_KEY) {
      throw new AiError('GROQ_API_KEY is not set', false);
    }

    const response = await fetchText(`${env.GROQ_BASE_URL}/chat/completions`, {
      method: 'POST',
      timeoutMs: env.AI_TIMEOUT_MS,
      maxBytes: 2_000_000,
      accept: 'application/json',
      headers: {
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.GROQ_MODEL,
        temperature: request.temperature ?? 0.3,
        max_tokens: request.maxTokens ?? 800,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      }),
    });

    if (response.status === 429) {
      throw new AiError('Groq rate limit reached', true, response.retryAfterMs);
    }

    if (response.status >= 500) {
      throw new AiError(`Groq server error (HTTP ${response.status})`, true);
    }

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;

      try {
        const parsed = JSON.parse(response.body) as ChatCompletion;
        detail = parsed.error?.message ?? detail;
      } catch {
        // Keep the status-code detail.
      }

      // A wrong or retired model id is a config problem — fail loudly, never silently degrade.
      throw new AiError(`Groq request rejected: ${detail}`, false);
    }

    const parsed = JSON.parse(response.body) as ChatCompletion;
    const text = parsed.choices?.[0]?.message?.content;

    if (!text) {
      throw new AiError('Groq returned an empty completion', true);
    }

    return { text, model: parsed.model ?? env.GROQ_MODEL };
  },
};
