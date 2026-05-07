import {
  type GenerationInput,
  type GenerationOutput,
  type LLMProvider,
  ProviderError,
} from './types.js';

export interface OllamaProviderOptions {
  baseUrl: string;
  model: string;
  /** Request timeout in ms. Default 60_000. */
  timeoutMs?: number;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
}

interface OllamaChatResponse {
  message?: { role: string; content: string };
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OllamaProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async generate(input: GenerationInput): Promise<GenerationOutput> {
    const start = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);

    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          options: {
            temperature: input.temperature ?? 0.7,
            num_predict: input.maxTokens ?? 400,
          },
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.user },
          ],
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw mapOllamaHttpError(res.status, body, this.name);
      }

      const json = (await res.json()) as OllamaChatResponse;
      const text = (json.message?.content ?? '').trim();

      if (text.length === 0) {
        throw new ProviderError('empty response', { provider: this.name, retryable: true });
      }

      return {
        text,
        provider: this.name,
        latencyMs: Date.now() - start,
        tokensIn: json.prompt_eval_count,
        tokensOut: json.eval_count,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      // AbortError from timeout, network errors, DNS, ECONNREFUSED → all retryable;
      // chain falls through if retries exhaust.
      throw new ProviderError(message, { provider: this.name, retryable: true, cause: err });
    } finally {
      clearTimeout(timer);
    }
  }
}

function mapOllamaHttpError(status: number, body: string, provider: string): ProviderError {
  if (status === 404) {
    // Model not pulled — not retryable on this provider, but worth falling through.
    return new ProviderError(`model not available on Ollama host: ${body}`, {
      provider,
      status,
      retryable: false,
    });
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new ProviderError(`HTTP ${status}: ${body}`, { provider, status, retryable: true });
  }
  return new ProviderError(`HTTP ${status}: ${body}`, { provider, status });
}
