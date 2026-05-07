import Anthropic, { APIError } from '@anthropic-ai/sdk';
import {
  type GenerationInput,
  type GenerationOutput,
  type LLMProvider,
  ProviderError,
} from './types.js';

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  /** Override for tests. */
  client?: Anthropic;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: AnthropicProviderOptions) {
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model;
  }

  async generate(input: GenerationInput): Promise<GenerationOutput> {
    const start = Date.now();
    try {
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: input.maxTokens ?? 400,
        temperature: input.temperature ?? 0.7,
        system: input.system,
        messages: [{ role: 'user', content: input.user }],
      });

      if (res.stop_reason === 'refusal') {
        throw new ProviderError('model refused to respond', {
          provider: this.name,
          fatal: true,
        });
      }

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();

      if (text.length === 0) {
        throw new ProviderError('empty response', { provider: this.name, retryable: true });
      }

      return {
        text,
        provider: this.name,
        latencyMs: Date.now() - start,
        tokensIn: res.usage.input_tokens,
        tokensOut: res.usage.output_tokens,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw mapAnthropicError(err, this.name);
    }
  }
}

function mapAnthropicError(err: unknown, provider: string): ProviderError {
  if (err instanceof APIError) {
    const status = err.status ?? 0;
    if (status === 401 || status === 403) {
      // Auth is a configuration error, not something the next provider
      // can recover. Fail the chain immediately so the user fixes .env.
      return new ProviderError(`auth failed: ${err.message}`, {
        provider,
        status,
        fatal: true,
      });
    }
    if (status === 400) {
      return new ProviderError(`bad request: ${err.message}`, { provider, status, fatal: true });
    }
    if (status === 429 || status === 408 || status === 529) {
      return new ProviderError(err.message, { provider, status, retryable: true });
    }
    if (status >= 500) {
      return new ProviderError(err.message, { provider, status, retryable: true });
    }
    return new ProviderError(err.message, { provider, status });
  }

  // Network / timeout / unknown
  const message = err instanceof Error ? err.message : String(err);
  return new ProviderError(message, { provider, retryable: true, cause: err });
}
