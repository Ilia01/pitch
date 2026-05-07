import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb } from '../core/db.js';
import { log } from '../lib/log.js';

const DEFAULT_CONFIG = {
  llm: {
    chain: ['anthropic', 'groq', 'ollama'],
    anthropic: { maxTokens: 400, temperature: 0.7 },
    groq: { maxTokens: 400, temperature: 0.7 },
    ollama: { maxTokens: 400, temperature: 0.7 },
  },
  send: {
    perSendDelayMs: 30_000,
    dailyCap: 30,
  },
};

export interface InitOptions {
  cwd?: string;
}

export function runInit({ cwd = process.cwd() }: InitOptions = {}): void {
  const dbPath = resolve(cwd, 'pitch.db');
  const configPath = resolve(cwd, 'pitch.config.json');
  const templatesDir = resolve(cwd, 'templates');
  const leadsDir = resolve(cwd, 'leads');

  mkdirSync(templatesDir, { recursive: true });
  mkdirSync(leadsDir, { recursive: true });

  if (!existsSync(configPath)) {
    writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
    log.info({ path: configPath }, 'wrote pitch.config.json');
  } else {
    log.info({ path: configPath }, 'pitch.config.json already exists, leaving alone');
  }

  const db = openDb({ path: dbPath });
  db.close();
  log.info({ path: dbPath }, 'initialized SQLite database');

  log.info('pitch workspace ready');
}
