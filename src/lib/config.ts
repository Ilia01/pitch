import { z } from 'zod';

const Bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : v.toLowerCase() === 'true'));

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),

  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),

  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('phi-4'),

  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().default('onboarding@resend.dev'),
  RESEND_TEST_EMAIL: z.string().email().optional(),
  RESEND_PROD: Bool.default(false),
  RESEND_DOMAIN: z.string().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '<env>'}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${msg}`);
  }
  return parsed.data;
}

/**
 * Throws if the env is configured for real sends but a sending domain is
 * not declared. Sandbox mode (RESEND_PROD=false) still requires a test
 * recipient so the user gets feedback on send attempts.
 */
export function assertSendReady(env: Env): void {
  if (!env.RESEND_API_KEY) {
    throw new ConfigError('RESEND_API_KEY is required to send.');
  }
  if (env.RESEND_PROD) {
    if (!env.RESEND_DOMAIN) {
      throw new ConfigError('RESEND_PROD=true requires RESEND_DOMAIN to be set.');
    }
    if (!env.RESEND_FROM_EMAIL.endsWith(`@${env.RESEND_DOMAIN}`)) {
      throw new ConfigError(
        `RESEND_FROM_EMAIL (${env.RESEND_FROM_EMAIL}) must use the verified domain (${env.RESEND_DOMAIN}).`,
      );
    }
  } else if (!env.RESEND_TEST_EMAIL) {
    throw new ConfigError('RESEND_TEST_EMAIL is required while RESEND_PROD=false (sandbox mode).');
  }
}
