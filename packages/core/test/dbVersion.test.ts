import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, SCHEMA_VERSION, SchemaTooNewError } from '../src/db.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-dbver-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const backupsOf = (h: string) => (existsSync(join(h, 'backups')) ? readdirSync(join(h, 'backups')) : []);

describe('schema version gate', () => {
  it('stamps a fresh database with the current schema version and takes no backup', () => {
    const db = openDb(home);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    db.close();
    expect(backupsOf(home)).toEqual([]);
  });

  it('backs up a pre-existing older database before migrating, then stamps it', () => {
    const first = openDb(home);
    first.prepare("INSERT INTO brands (id, slug, json) VALUES ('b1', 'acme', '{}')").run();
    first.pragma('user_version = 0'); // simulate a database written before versioning existed
    first.close();

    const db = openDb(home);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.prepare('SELECT COUNT(*) AS n FROM brands').get()).toEqual({ n: 1 });
    db.close();

    const backups = backupsOf(home);
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^scenri-v0-\d{8}-\d{6}\.db$/);
    const snap = new Database(join(home, 'backups', backups[0]), { readonly: true });
    expect(snap.prepare('SELECT COUNT(*) AS n FROM brands').get()).toEqual({ n: 1 });
    snap.close();
  });

  it('refuses to open a database written by a newer Scenri', () => {
    const db = openDb(home);
    db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    db.close();

    expect(() => openDb(home)).toThrow(SchemaTooNewError);
    try {
      openDb(home);
    } catch (e) {
      expect((e as Error).message).toContain('newer');
      // the operator's way out of a rollback wedge: the message names where
      // the pre-migration snapshot lives
      expect((e as Error).message).toContain(join(home, 'backups'));
    }
  });

  it('keeps only the three newest backups', () => {
    mkdirSync(join(home, 'backups'), { recursive: true });
    for (const stamp of ['20200101-000000', '20200102-000000', '20200103-000000']) {
      writeFileSync(join(home, 'backups', `scenri-v0-${stamp}.db`), 'old');
    }
    const first = openDb(home);
    first.pragma('user_version = 0');
    first.close();
    openDb(home).close(); // takes a fourth backup → oldest goes

    const backups = backupsOf(home).sort();
    expect(backups).toHaveLength(3);
    expect(backups).not.toContain('scenri-v0-20200101-000000.db');
  });
});
