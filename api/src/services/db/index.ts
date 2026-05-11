import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import type { Database as SqliteDb } from 'better-sqlite3';
import { createLogger } from '../logger';

const log = createLogger('db');

export type DB = SqliteDb;

let instance: SqliteDb | null = null;

export function openDatabase(dbPath: string): SqliteDb {
  if (instance) return instance;

  const abs = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });

  const db = new Database(abs);

  // Pragmas: FKs are required by the schema (every module's tables reference
  // others), WAL gives concurrent reads alongside the worker writes.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  log.info('database opened', { path: abs });
  instance = db;
  return db;
}

export function closeDatabase(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
