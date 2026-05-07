import { describe, expect, it } from 'vitest';
import { ConfigError, assertSendReady, loadEnv } from '../src/lib/config.js';

describe('loadEnv', () => {
  it('applies defaults when env is empty', () => {
    const env = loadEnv({});
    expect(env.RESEND_PROD).toBe(false);
    expect(env.OLLAMA_BASE_URL).toBe('http://localhost:11434');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('coerces RESEND_PROD from string', () => {
    const env = loadEnv({ RESEND_PROD: 'true' });
    expect(env.RESEND_PROD).toBe(true);
  });

  it('rejects malformed email', () => {
    expect(() => loadEnv({ RESEND_FROM_EMAIL: 'not-an-email' })).toThrow(ConfigError);
  });
});

describe('assertSendReady', () => {
  const baseSandbox = loadEnv({
    RESEND_API_KEY: 'rk_test',
    RESEND_TEST_EMAIL: 'me@example.com',
  });

  it('passes in sandbox with a test recipient', () => {
    expect(() => assertSendReady(baseSandbox)).not.toThrow();
  });

  it('fails sandbox without a test recipient', () => {
    const env = loadEnv({ RESEND_API_KEY: 'rk_test' });
    expect(() => assertSendReady(env)).toThrowError(/RESEND_TEST_EMAIL is required/);
  });

  it('fails when prod mode lacks a domain', () => {
    const env = loadEnv({ RESEND_API_KEY: 'rk_live', RESEND_PROD: 'true' });
    expect(() => assertSendReady(env)).toThrowError(/RESEND_DOMAIN to be set/);
  });

  it('fails when prod from-email does not match domain', () => {
    const env = loadEnv({
      RESEND_API_KEY: 'rk_live',
      RESEND_PROD: 'true',
      RESEND_DOMAIN: 'iliareach.com',
      RESEND_FROM_EMAIL: 'ilia@elsewhere.com',
    });
    expect(() => assertSendReady(env)).toThrowError(/must use the verified domain/);
  });

  it('passes when prod config is internally consistent', () => {
    const env = loadEnv({
      RESEND_API_KEY: 'rk_live',
      RESEND_PROD: 'true',
      RESEND_DOMAIN: 'iliareach.com',
      RESEND_FROM_EMAIL: 'ilia@iliareach.com',
    });
    expect(() => assertSendReady(env)).not.toThrow();
  });

  it('fails when API key is missing', () => {
    const env = loadEnv({ RESEND_TEST_EMAIL: 'me@example.com' });
    expect(() => assertSendReady(env)).toThrowError(/RESEND_API_KEY is required/);
  });
});
