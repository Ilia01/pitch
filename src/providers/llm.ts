import { log } from '../lib/log.js';
import {
  AllProvidersFailedError,
  type GenerationInput,
  type GenerationOutput,
  type LLMProvider,
  ProviderError,
} from './types.js';

export interface ChainOptions {
  /** Max attempts per provider (1 = no retry). Default 3. */
  maxAttempts?: number;
  /** Base backoff in ms; doubled per retry. Default 250ms. */
  baseBackoffMs?: number;
  /** Sleep function override for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run providers in priority order. For each:
 *   - Retry up to maxAttempts on retryable errors with exponential backoff.
 *   - On fatal error, throw immediately (no fall-through).
 *   - On exhausted retries or non-retryable error, fall through to next.
 * If all providers exhausted, throw AllProvidersFailedError.
 */
export async function runChain(
  providers: LLMProvider[],
  input: GenerationInput,
  opts: ChainOptions = {},
): Promise<GenerationOutput> {
  if (providers.length === 0) {
    throw new Error('runChain: no providers configured');
  }
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseBackoffMs = opts.baseBackoffMs ?? 250;
  const sleep = opts.sleep ?? defaultSleep;

  const collected: ProviderError[] = [];

  for (const provider of providers) {
    let lastError: ProviderError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const out = await provider.generate(input);
        log.debug(
          {
            provider: provider.name,
            attempt,
            latencyMs: out.latencyMs,
            tokensIn: out.tokensIn,
            tokensOut: out.tokensOut,
          },
          'generation ok',
        );
        return out;
      } catch (err) {
        const pe =
          err instanceof ProviderError
            ? err
            : new ProviderError(err instanceof Error ? err.message : String(err), {
                provider: provider.name,
                retryable: false,
                cause: err,
              });

        if (pe.fatal) {
          log.error(
            { provider: provider.name, attempt, error: pe.message },
            'fatal provider error, aborting chain',
          );
          throw pe;
        }

        log.warn(
          {
            provider: provider.name,
            attempt,
            retryable: pe.retryable,
            status: pe.status,
            error: pe.message,
          },
          'provider attempt failed',
        );

        lastError = pe;

        if (!pe.retryable || attempt === maxAttempts) break;
        await sleep(baseBackoffMs * 2 ** (attempt - 1));
      }
    }

    if (lastError) collected.push(lastError);
  }

  throw new AllProvidersFailedError(collected);
}
