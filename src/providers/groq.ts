import Groq, { APIError } from 'groq-sdk';
import {
  type GenerationInput,
  type GenerationOutput,
  type LLMProvider,
  ProviderError,
} from './types.js';

export interface GroqProviderOptions {
  apiKey: string;
  model: string;
  client?: Groq;
}

export class GroqProvider implements LLMProvider {
  readonly name = 'groq';
  private readonly client: Groq;
  private readonly model: string;

  constructor(opts: GroqProviderOptions) {
    this.client = opts.client ?? new Groq({ apiKey: opts.apiKey });
    this.model = opts.model;
  }

  async generate(input: GenerationInput): Promise<GenerationOutput> {
    const start = Date.now();
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: input.maxTokens ?? 400,
        temperature: input.temperature ?? 0.7,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
      });

      const choice = res.choices[0];
      if (!choice) {
        throw new ProviderError('no choices in response', { provider: this.name, retryable: true });
      }

      // Groq's typed enum doesn't include 'content_filter' but the API may
      // still return it for safety blocks. Compare loosely.
      if (String(choice.finish_reason) === 'content_filter') {
        throw new ProviderError('safety filter triggered', {
          provider: this.name,
          fatal: true,
        });
      }

      const text = (choice.message.content ?? '').trim();
      if (text.length === 0) {
        throw new ProviderError('empty response', { provider: this.name, retryable: true });
      }

      return {
        text,
        provider: this.name,
        latencyMs: Date.now() - start,
        tokensIn: res.usage?.prompt_tokens,
        tokensOut: res.usage?.completion_tokens,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw mapGroqError(err, this.name);
    }
  }
}

function mapGroqError(err: unknown, provider: string): ProviderError {
  if (err instanceof APIError) {
    const status = err.status ?? 0;
    if (status === 401 || status === 403) {
      return new ProviderError(`auth failed: ${err.message}`, {
        provider,
        status,
        fatal: true,
      });
    }
    if (status === 400) {
      return new ProviderError(`bad request: ${err.message}`, { provider, status, fatal: true });
    }
    if (status === 429 || status === 408) {
      return new ProviderError(err.message, { provider, status, retryable: true });
    }
    if (status >= 500) {
      return new ProviderError(err.message, { provider, status, retryable: true });
    }
    return new ProviderError(err.message, { provider, status });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new ProviderError(message, { provider, retryable: true, cause: err });
}
