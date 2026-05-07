import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/core/db.js';
import {
  TemplateError,
  addTemplate,
  getTemplateByName,
  listTemplates,
} from '../src/core/templates.js';

const MIGRATIONS_DIR = resolve(__dirname, '../migrations');

describe('templates', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pitch-tmpl-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function newDb() {
    return openDb({ path: join(dir, 'pitch.db'), migrationsDir: MIGRATIONS_DIR });
  }

  function writeBody(content: string): string {
    const path = join(dir, 'body.md');
    writeFileSync(path, content);
    return path;
  }

  it('adds a template and reads it back', () => {
    const db = newDb();
    const bodyPath = writeBody('Hi {{name}},\n\n{{hook}}\n\n— Ilia');
    const tmpl = addTemplate(db, {
      name: 'jobs-intro',
      subject: 'Quick question, {{name}}',
      bodyPath,
    });
    expect(tmpl.id).toBeGreaterThan(0);
    expect(tmpl.name).toBe('jobs-intro');
    expect(tmpl.body_md).toContain('{{hook}}');

    const fetched = getTemplateByName(db, 'jobs-intro');
    expect(fetched?.subject).toBe('Quick question, {{name}}');
    db.close();
  });

  it('rejects duplicate template names', () => {
    const db = newDb();
    const bodyPath = writeBody('body');
    addTemplate(db, { name: 'intro', subject: 'Hi', bodyPath });
    expect(() => addTemplate(db, { name: 'intro', subject: 'Hi', bodyPath })).toThrow(
      TemplateError,
    );
    db.close();
  });

  it('rejects an empty body', () => {
    const db = newDb();
    const bodyPath = writeBody('');
    expect(() => addTemplate(db, { name: 'empty', subject: 'Hi', bodyPath })).toThrow(
      /body cannot be empty/,
    );
    db.close();
  });

  it('rejects a missing body file', () => {
    const db = newDb();
    expect(() =>
      addTemplate(db, {
        name: 'missing',
        subject: 'Hi',
        bodyPath: join(dir, 'does-not-exist.md'),
      }),
    ).toThrow(/could not read body file/);
    db.close();
  });

  it('rejects invalid name characters', () => {
    const db = newDb();
    const bodyPath = writeBody('body');
    expect(() => addTemplate(db, { name: 'has spaces', subject: 'Hi', bodyPath })).toThrow(
      /alphanumeric/,
    );
    db.close();
  });

  it('lists templates newest first', () => {
    const db = newDb();
    const bodyPath = writeBody('body');
    addTemplate(db, { name: 'first', subject: 'A', bodyPath });
    addTemplate(db, { name: 'second', subject: 'B', bodyPath });
    const all = listTemplates(db);
    expect(all.map((t) => t.name)).toEqual(['second', 'first']);
    db.close();
  });
});
