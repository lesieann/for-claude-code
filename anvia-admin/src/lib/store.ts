import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { TableName, Tables } from './types';

/**
 * 資料存取層。
 * - 有 SUPABASE_URL → 連 Supabase（schema 見 db/schema.sql）
 * - 沒有 → 本機 data/dev-db.json（.gitignore 已排除，不會進 repo）
 */
type Row<T extends TableName> = Tables[T];
type NewRow<T extends TableName> = Omit<Row<T>, 'id' | 'created_at'> & Partial<Pick<Row<T>, 'created_at'>>;

export interface Store {
  list<T extends TableName>(t: T): Promise<Row<T>[]>;
  get<T extends TableName>(t: T, id: number): Promise<Row<T> | null>;
  insert<T extends TableName>(t: T, data: NewRow<T>): Promise<Row<T>>;
  update<T extends TableName>(t: T, id: number, patch: Partial<Row<T>>): Promise<Row<T>>;
  remove(t: TableName, id: number): Promise<void>;
  getSetting<V = unknown>(key: string): Promise<V | null>;
  setSetting(key: string, value: unknown): Promise<void>;
}

/* ── 本機 JSON ───────────────────────────────────── */
type DB = { [K in TableName]: Row<K>[] } & { settings: Record<string, unknown>; seq: Record<string, number> };
const DB_FILE = path.join(process.cwd(), 'data', 'dev-db.json');
const emptyDB = (): DB => ({ customers: [], batches: [], orders: [], shipments: [], payments: [], settings: {}, seq: {} });

let queue: Promise<unknown> = Promise.resolve();
function locked<R>(fn: () => Promise<R>): Promise<R> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}
async function readDB(): Promise<DB> {
  try {
    return { ...emptyDB(), ...JSON.parse(await fs.readFile(DB_FILE, 'utf8')) };
  } catch {
    return emptyDB();
  }
}
async function writeDB(db: DB) {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  const tmp = DB_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(db, null, 1));
  await fs.rename(tmp, DB_FILE);
}

const jsonStore: Store = {
  async list(t) {
    return (await readDB())[t] as never;
  },
  async get(t, id) {
    return (((await readDB())[t] as { id: number }[]).find((r) => r.id === id) as never) ?? null;
  },
  insert(t, data) {
    return locked(async () => {
      const db = await readDB();
      const rows = db[t] as { id: number }[];
      const id = (db.seq[t] = Math.max(db.seq[t] ?? 0, ...rows.map((r) => r.id), 0) + 1);
      const row = { created_at: new Date().toISOString(), ...data, id };
      rows.push(row);
      await writeDB(db);
      return row as never;
    });
  },
  update(t, id, patch) {
    return locked(async () => {
      const db = await readDB();
      const rows = db[t] as { id: number }[];
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) throw new Error(`${t} #${id} 不存在`);
      rows[i] = { ...rows[i], ...patch, id };
      await writeDB(db);
      return rows[i] as never;
    });
  },
  remove(t, id) {
    return locked(async () => {
      const db = await readDB();
      (db[t] as { id: number }[]) = (db[t] as { id: number }[]).filter((r) => r.id !== id);
      await writeDB(db);
    });
  },
  async getSetting(key) {
    return ((await readDB()).settings[key] as never) ?? null;
  },
  setSetting(key, value) {
    return locked(async () => {
      const db = await readDB();
      db.settings[key] = value;
      await writeDB(db);
    });
  },
};

/* ── Supabase ────────────────────────────────────── */
function supabaseStore(sb: SupabaseClient): Store {
  const ok = <D>(r: { data: D; error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  return {
    async list(t) {
      return ok(await sb.from(t).select('*').order('id')) as never;
    },
    async get(t, id) {
      return ok(await sb.from(t).select('*').eq('id', id).maybeSingle()) as never;
    },
    async insert(t, data) {
      return ok(await sb.from(t).insert(data).select().single()) as never;
    },
    async update(t, id, patch) {
      const { id: _drop, ...rest } = patch as { id?: number };
      return ok(await sb.from(t).update(rest).eq('id', id).select().single()) as never;
    },
    async remove(t, id) {
      ok(await sb.from(t).delete().eq('id', id));
    },
    async getSetting(key) {
      const r = ok(await sb.from('settings').select('value').eq('key', key).maybeSingle()) as { value: unknown } | null;
      return (r?.value as never) ?? null;
    },
    async setSetting(key, value) {
      ok(await sb.from('settings').upsert({ key, value, updated_at: new Date().toISOString() }));
    },
  };
}

let cached: Store | null = null;
export function store(): Store {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached = url && key ? supabaseStore(createClient(url, key, { auth: { persistSession: false } })) : jsonStore;
  return cached;
}

export const storeKind = () => (process.env.SUPABASE_URL ? 'Supabase' : '本機 JSON（data/dev-db.json）');
