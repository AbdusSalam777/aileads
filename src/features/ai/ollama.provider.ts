import { env } from '../../config/env.js';
import { fetchText } from '../../shared/http-fetch.js';
import { AiError, type AiProvider, type ChatRequest } from './ai.types.js';

type OllamaChatResponse = {
  message?: { content?: string };
  model?: string;
  error?: string;
};

/** Fully local escape hatch: no account, no key, no per-token cost. */
export const ollamaProvider: AiProvider = {
  name: 'ollama',
  model: env.OLLAMA_MODEL,

  async chat(request: ChatRequest) {
    const response = await fetchText(`${env.OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      timeoutMs: env.AI_TIMEOUT_MS,
      maxBytes: 2_000_000,
      accept: 'application/json',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        stream: false,
        format: 'json',
        options: { temperature: request.temperature ?? 0.3 },
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      }),
    });

    if (!response.ok) {
      throw new AiError(`Ollama request failed (HTTP ${response.status})`, response.status >= 500);
    }

    const parsed = JSON.parse(response.body) as OllamaChatResponse;

    if (parsed.error) {
      throw new AiError(`Ollama error: ${parsed.error}`, false);
    }

    const text = parsed.message?.content;

    if (!text) {
      throw new AiError('Ollama returned an empty completion', true);
    }

    return { text, model: parsed.model ?? env.OLLAMA_MODEL };
  },
};
