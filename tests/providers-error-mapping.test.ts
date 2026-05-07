import { describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import { GroqProvider } from '../src/providers/groq.js';
import { ProviderError } from '../src/providers/types.js';

/**
 * These tests stub the SDK clients and assert that HTTP error codes map
 * to the right ProviderError flags (retryable / fatal / neither). The
 * chain runner depends on this classification — getting it wrong means
 * auth errors silently swap providers or transient blips hard-fail.
 */

interface FakeApiError {
  status: number;
  message: string;
}

function makeApiError(status: number, message = 'simulated'): Error {
  // Subclass APIError-like shape that the mapper detects via instanceof.
  // Since APIError is the SDK's class, we mimic by extending Error and
  // adding the same shape; the mapper falls through to the network branch
  // for non-APIError, so we need to actually use the SDK's class. Instead,
  // we drive the provider via a stub client that throws the SDK's APIError.
  const err = Object.assign(new Error(message), { status }) as Error & FakeApiError;
  return err;
}

// Helpers that build a minimal stub client that throws what we want.
function anthropicClientThrowing(err: unknown) {
  return {
    messages: {
      create: async () => {
        throw err;
      },
    },
  } as unknown as ConstructorParameters<typeof AnthropicProvider>[0]['client'];
}

function groqClientThrowing(err: unknown) {
  return {
    chat: {
      completions: {
        create: async () => {
          throw err;
        },
      },
    },
  } as unknown as ConstructorParameters<typeof GroqProvider>[0]['client'];
}

describe('AnthropicProvider error mapping', () => {
  async function expectError(status: number) {
    const provider = new AnthropicProvider({
      apiKey: 'test',
      model: 'm',
      client: anthropicClientThrowing(makeApiError(status)),
    });
    return provider.generate({ system: 's', user: 'u' }).catch((e) => e as ProviderError);
  }

  it('non-APIError network failures map to retryable', async () => {
    const err = await expectError(0); // status 0 mimics non-APIError
    // The non-APIError branch only fires when err is NOT an APIError instance.
    // Our makeApiError isn't a real APIError, so this exercises the network
    // branch. Asserting retryable is the contract.
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).retryable).toBe(true);
  });
});

describe('AnthropicProvider with real APIError', () => {
  // Use the SDK's actual APIError class so instanceof check fires.
  it('maps 401 to fatal (no fall-through, no retry)', async () => {
    const { APIError } = await import('@anthropic-ai/sdk');
    const provider = new AnthropicProvider({
      apiKey: 'test',
      model: 'm',
      client: anthropicClientThrowing(
        new APIError(401, { error: { message: 'invalid api key' } }, 'unauthorized', new Headers()),
      ),
    });
    const err = (await provider
      .generate({ system: 's', user: 'u' })
      .catch((e) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.fatal).toBe(true);
    expect(err.retryable).toBe(false);
    expect(err.status).toBe(401);
  });

  it('maps 400 to fatal', async () => {
    const { APIError } = await import('@anthropic-ai/sdk');
    const provider = new AnthropicProvider({
      apiKey: 'test',
      model: 'm',
      client: anthropicClientThrowing(
        new APIError(400, { error: { message: 'bad' } }, 'bad request', new Headers()),
      ),
    });
    const err = (await provider
      .generate({ system: 's', user: 'u' })
      .catch((e) => e)) as ProviderError;
    expect(err.fatal).toBe(true);
  });

  it('maps 429 to retryable', async () => {
    const { APIError } = await import('@anthropic-ai/sdk');
    const provider = new AnthropicProvider({
      apiKey: 'test',
      model: 'm',
      client: anthropicClientThrowing(
        new APIError(429, { error: { message: 'rate' } }, 'too many', new Headers()),
      ),
    });
    const err = (await provider
      .generate({ system: 's', user: 'u' })
      .catch((e) => e)) as ProviderError;
    expect(err.retryable).toBe(true);
    expect(err.fatal).toBe(false);
  });

  it('maps 500 to retryable', async () => {
    const { APIError } = await import('@anthropic-ai/sdk');
    const provider = new AnthropicProvider({
      apiKey: 'test',
      model: 'm',
      client: anthropicClientThrowing(
        new APIError(500, { error: { message: 'oops' } }, 'server', new Headers()),
      ),
    });
    const err = (await provider
      .generate({ system: 's', user: 'u' })
      .catch((e) => e)) as ProviderError;
    expect(err.retryable).toBe(true);
  });
});

describe('GroqProvider with real APIError', () => {
  it('maps 401 to fatal', async () => {
    const { APIError } = await import('groq-sdk');
    const provider = new GroqProvider({
      apiKey: 'test',
      model: 'm',
      client: groqClientThrowing(
        new APIError(401, { error: { message: 'auth' } }, 'unauthorized', new Headers()),
      ),
    });
    const err = (await provider
      .generate({ system: 's', user: 'u' })
      .catch((e) => e)) as ProviderError;
    expect(err.fatal).toBe(true);
  });

  it('maps 429 to retryable', async () => {
    const { APIError } = await import('groq-sdk');
    const provider = new GroqProvider({
      apiKey: 'test',
      model: 'm',
      client: groqClientThrowing(
        new APIError(429, { error: { message: 'rate' } }, 'too many', new Headers()),
      ),
    });
    const err = (await provider
      .generate({ system: 's', user: 'u' })
      .catch((e) => e)) as ProviderError;
    expect(err.retryable).toBe(true);
  });
});
