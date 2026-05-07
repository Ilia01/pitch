import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Env } from '../lib/config.js';
import { log } from '../lib/log.js';
import { AnthropicProvider } from './anthropic.js';
import { GroqProvider } from './groq.js';
import { OllamaProvider } from './ollama.js';
import type { LLMProvider } from './types.js';

const ConfigSchema = z.object({
  llm: z
    .object({
      chain: z
        .array(z.enum(['anthropic', 'groq', 'ollama']))
        .default(['anthropic', 'groq', 'ollama']),
    })
    .partial()
    .optional(),
});

type ProviderName = 'anthropic' | 'groq' | 'ollama';

export interface BuildChainOptions {
  env: Env;
  /** Workspace directory (where pitch.config.json lives). Default cwd. */
  cwd?: string;
}

/**
 * Build the provider chain from env + pitch.config.json. Skips providers
 * with missing credentials and logs a warning so the user knows their
 * config is partial.
 */
export function buildChain(opts: BuildChainOptions): LLMProvider[] {
  const cwd = opts.cwd ?? process.cwd();
  const order = readChainOrder(cwd);

  const chain: LLMProvider[] = [];
  for (const name of order) {
    const provider = tryBuild(name, opts.env);
    if (provider) chain.push(provider);
  }

  if (chain.length === 0) {
    throw new Error(
      'no LLM providers configured. set ANTHROPIC_API_KEY, GROQ_API_KEY, or OLLAMA_BASE_URL in .env',
    );
  }
  return chain;
}

function readChainOrder(cwd: string): ProviderName[] {
  const path = resolve(cwd, 'pitch.config.json');
  if (!existsSync(path)) return ['anthropic', 'groq', 'ollama'];
  try {
    const json = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    const parsed = ConfigSchema.safeParse(json);
    return parsed.success && parsed.data.llm?.chain
      ? parsed.data.llm.chain
      : ['anthropic', 'groq', 'ollama'];
  } catch (err) {
    log.warn(
      { path, err: err instanceof Error ? err.message : err },
      'pitch.config.json invalid, using defaults',
    );
    return ['anthropic', 'groq', 'ollama'];
  }
}

function tryBuild(name: ProviderName, env: Env): LLMProvider | undefined {
  switch (name) {
    case 'anthropic':
      if (!env.ANTHROPIC_API_KEY) {
        log.debug('skipping anthropic: ANTHROPIC_API_KEY not set');
        return undefined;
      }
      return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL });
    case 'groq':
      if (!env.GROQ_API_KEY) {
        log.debug('skipping groq: GROQ_API_KEY not set');
        return undefined;
      }
      return new GroqProvider({ apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL });
    case 'ollama':
      // OLLAMA_BASE_URL has a default; building it always works at config time,
      // but the provider will fail-soft if the host is unreachable.
      return new OllamaProvider({ baseUrl: env.OLLAMA_BASE_URL, model: env.OLLAMA_MODEL });
    default:
      return undefined;
  }
}
