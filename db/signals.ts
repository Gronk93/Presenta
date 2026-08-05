import { env } from "cloudflare:workers";

let schemaReady: Promise<void> | null = null;

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = env.DB;
      if (!db) throw new Error("D1 binding DB is unavailable");
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS signals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room TEXT NOT NULL,
          role TEXT NOT NULL,
          kind TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`),
        db.prepare("CREATE INDEX IF NOT EXISTS idx_signals_room_id ON signals(room, id)"),
      ]);
    })();
  }
  return schemaReady;
}

export async function addSignal(room: string, role: string, kind: string, payload: string) {
  await ensureSchema();
  const now = Date.now();
  const staleBefore = now - 10 * 60 * 1000;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM signals WHERE created_at < ?").bind(staleBefore),
    env.DB.prepare("INSERT INTO signals (room, role, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(room, role, kind, payload, now),
  ]);
}

export async function clearSignals(room: string) {
  await ensureSchema();
  await env.DB.prepare("DELETE FROM signals WHERE room = ?").bind(room).run();
}

export async function listSignals(room: string, otherRole: string, after: number) {
  await ensureSchema();
  const result = await env.DB.prepare(
    "SELECT id, kind, payload FROM signals WHERE room = ? AND role != ? AND id > ? ORDER BY id ASC LIMIT 100",
  ).bind(room, otherRole, after).all<{ id: number; kind: string; payload: string }>();
  return result.results;
}
