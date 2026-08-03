import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const signals = sqliteTable(
  "signals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    room: text("room").notNull(),
    role: text("role").notNull(),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_signals_room_id").on(table.room, table.id)],
);
