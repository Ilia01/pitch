import { describe, expect, it, vi } from 'vitest';
import { runChain } from '../src/providers/llm.js';
import {
  AllProvidersFailedError,
  type GenerationInput,
  type GenerationOutput,
  type LLMProvider,
  ProviderError,
} from '../src/providers/types.js';

interface MockBehavior {
  outcomes: Array<'ok' | 'retryable' | 'non-retryable' | 'fatal' | 'auth'>;
  text?: string;
}

function mockProvider(name: string, behavior: MockBehavior): LLMProvider & { calls: number } {
  let calls = 0;
  const provider: LLMProvider & { calls: number } = {
    name,
    get calls() {
      return calls;
    },
    async generate(_input: GenerationInput): Promise<GenerationOutput> {
      const outcome = behavior.outcomes[calls] ?? 'non-retryable';
      calls += 1;
      switch (outcome) {
        case 'ok':
          return {
            text: behavior.text ?? `from-${name}`,
            provider: name,
            latencyMs: 1,
          };
        case 'retryable':
          throw new ProviderError('rate limited', { provider: name, retryable: true, status: 429 });
        case 'non-retryable':
          throw new ProviderError('boom', { provider: name, retryable: false });
        case 'fatal':
          throw new ProviderError('refusal', { provider: name, fatal: true });
        case 'auth':
          throw new ProviderError('auth failed', { provider: name, retryable: false, status: 401 });
      }
    },
  } as LLMProvider & { calls: number };
  return provider;
}

const noSleep = (_ms: number) => Promise.resolve();
const input: GenerationInput = { system: 's', user: 'u' };

describe('runChain', () => {
  it('returns the first successful provider output', async () => {
    const a = mockProvider('a', { outcomes: ['ok'] });
    const b = mockProvider('b', { outcomes: ['ok'] });
    const out = await runChain([a, b], input, { sleep: noSleep });
    expect(out.text).toBe('from-a');
    expect(out.provider).toBe('a');
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(0);
  });

  it('retries the same provider on retryable errors', async () => {
    const a = mockProvider('a', { outcomes: ['retryable', 'retryable', 'ok'] });
    const out = await runChain([a], input, { maxAttempts: 3, sleep: noSleep });
    expect(out.provider).toBe('a');
    expect(a.calls).toBe(3);
  });

  it('falls through to next provider after retries exhausted', async () => {
    const a = mockProvider('a', { outcomes: ['retryable', 'retryable', 'retryable'] });
    const b = mockProvider('b', { outcomes: ['ok'] });
    const out = await runChain([a, b], input, { maxAttempts: 3, sleep: noSleep });
    expect(out.provider).toBe('b');
    expect(a.calls).toBe(3);
    expect(b.calls).toBe(1);
  });

  it('falls through immediately on non-retryable error (no retry on same provider)', async () => {
    const a = mockProvider('a', { outcomes: ['non-retryable', 'ok'] });
    const b = mockProvider('b', { outcomes: ['ok'] });
    const out = await runChain([a, b], input, { maxAttempts: 3, sleep: noSleep });
    expect(out.provider).toBe('b');
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(1);
  });

  it('falls through on auth failure', async () => {
    const a = mockProvider('a', { outcomes: ['auth'] });
    const b = mockProvider('b', { outcomes: ['ok'] });
    const out = await runChain([a, b], input, { sleep: noSleep });
    expect(out.provider).toBe('b');
  });

  it('hard-fails on fatal error (no fallthrough, no retry)', async () => {
    const a = mockProvider('a', { outcomes: ['fatal'] });
    const b = mockProvider('b', { outcomes: ['ok'] });
    await expect(runChain([a, b], input, { sleep: noSleep })).rejects.toThrowError(ProviderError);
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(0);
  });

  it('throws AllProvidersFailedError when every provider exhausts', async () => {
    const a = mockProvider('a', { outcomes: ['retryable', 'retryable', 'retryable'] });
    const b = mockProvider('b', { outcomes: ['non-retryable'] });
    const error = await runChain([a, b], input, { maxAttempts: 3, sleep: noSleep }).catch((e) => e);
    expect(error).toBeInstanceOf(AllProvidersFailedError);
    expect((error as AllProvidersFailedError).errors).toHaveLength(2);
    expect((error as AllProvidersFailedError).errors[0]?.provider).toBe('a');
    expect((error as AllProvidersFailedError).errors[1]?.provider).toBe('b');
  });

  it('rejects an empty provider list', async () => {
    await expect(runChain([], input)).rejects.toThrow(/no providers/);
  });

  it('uses provided sleep with exponential backoff between retries', async () => {
    const sleep = vi.fn(noSleep);
    const a = mockProvider('a', { outcomes: ['retryable', 'retryable', 'ok'] });
    await runChain([a], input, { maxAttempts: 3, baseBackoffMs: 100, sleep });
    expect(sleep).toHaveBeenCalledWith(100);
    expect(sleep).toHaveBeenCalledWith(200);
  });
});
