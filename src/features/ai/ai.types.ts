export type ChatRequest = {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
};

export type ChatResult = {
  text: string;
  model: string;
};

export type AiProvider = {
  name: 'groq' | 'ollama' | 'stub';
  model: string;
  chat(request: ChatRequest): Promise<ChatResult>;
};

export class AiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
