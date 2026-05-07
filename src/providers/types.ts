export interface GenerationInput {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GenerationOutput {
  text: string;
  provider: string;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
}

export interface LLMProvider {
  readonly name: string;
  generate(input: GenerationInput): Promise<GenerationOutput>;
}

/**
 * Errors thrown by providers. The chain runner inspects `retryable` and
 * `fatal` to decide whether to retry the same provider, fall through to the
 * next, or hard-fail to the caller.
 *
 *   retryable=true   → same-provider retry with backoff
 *   retryable=false  → fall through to next provider in chain
 *   fatal=true       → never fall through; surface to user immediately
 *                       (used for safety refusals and 400-class bugs)
 */
export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  readonly provider: string;
  readonly retryable: boolean;
  readonly fatal: boolean;
  readonly status?: number;
  override readonly cause?: unknown;

  constructor(
    message: string,
    opts: {
      provider: string;
      retryable?: boolean;
      fatal?: boolean;
      status?: number;
      cause?: unknown;
    },
  ) {
    super(message);
    this.provider = opts.provider;
    this.retryable = opts.retryable ?? false;
    this.fatal = opts.fatal ?? false;
    this.status = opts.status;
    this.cause = opts.cause;
  }
}

export class AllProvidersFailedError extends Error {
  override readonly name = 'AllProvidersFailedError';
  readonly errors: ProviderError[];

  constructor(errors: ProviderError[]) {
    super(`all providers failed: ${errors.map((e) => `${e.provider}: ${e.message}`).join(' | ')}`);
    this.errors = errors;
  }
}
