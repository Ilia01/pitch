import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { openDb } from '../core/db.js';
import { getDraftById, updateDraftBody } from '../core/drafts.js';
import { log } from '../lib/log.js';

function dbPath(): string {
  return resolve(process.cwd(), 'pitch.db');
}

function pickEditor(): string {
  return (
    process.env.VISUAL || process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'vi')
  );
}

export const editCommand = new Command('edit')
  .description('Open a draft in $EDITOR for tweaking')
  .argument('<id>', 'draft id', (v) => Number.parseInt(v, 10))
  .action((id: number): void => {
    const db = openDb({ path: dbPath() });
    try {
      const draft = getDraftById(db, id);
      if (!draft) {
        log.error({ id }, 'draft not found');
        process.exitCode = 1;
        return;
      }

      const dir = mkdtempSync(join(tmpdir(), 'pitch-edit-'));
      const file = join(dir, `draft-${id}.md`);
      writeFileSync(file, draft.body_md);

      const editor = pickEditor();
      const result = spawnSync(editor, [file], { stdio: 'inherit' });
      if (result.status !== 0) {
        log.error(
          { editor, status: result.status },
          'editor exited non-zero, leaving draft unchanged',
        );
        rmSync(dir, { recursive: true, force: true });
        process.exitCode = 1;
        return;
      }

      const updated = readFileSync(file, 'utf-8');
      rmSync(dir, { recursive: true, force: true });

      if (updated === draft.body_md) {
        log.info({ id }, 'no changes');
        return;
      }

      // For v0.1, body == body_md (no separate render step until Phase 4 sends).
      updateDraftBody(db, id, updated, updated);
      log.info({ id, edited: true }, 'draft updated');
    } finally {
      db.close();
    }
  });
