import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCHEMA_SQL } from './schema.js';

const here = dirname(fileURLToPath(import.meta.url));

/** 仓库根目录。src/db 与 dist/db 都在同一深度，向上四级都能回到项目根。 */
export const PROJECT_ROOT = resolve(here, '../../../..');

export const DATA_DIR = process.env.IA_DATA_DIR ?? resolve(PROJECT_ROOT, 'data');
export const UPLOAD_DIR = resolve(DATA_DIR, 'uploads');
export const DB_PATH = process.env.IA_DB_PATH ?? resolve(DATA_DIR, 'app.db');

mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec(SCHEMA_SQL);

export function nowIso(): string {
  return new Date().toISOString();
}

/** 查询多行。 */
export function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}

/** 查询单行，无结果返回 undefined。 */
export function get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...(params as never[])) as T | undefined;
}

/** 执行写入。 */
export function run(sql: string, ...params: unknown[]): void {
  db.prepare(sql).run(...(params as never[]));
}

/** 读取配置项，值按 JSON 解析。 */
export function getConfig<T>(key: string): T | undefined {
  const row = get<{ value: string }>('SELECT value FROM app_config WHERE key = ?', key);
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return undefined;
  }
}

/** 写入配置项。 */
export function setConfig(key: string, value: unknown): void {
  run(
    `INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    JSON.stringify(value),
    nowIso(),
  );
}
