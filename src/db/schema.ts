import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const statusResults = sqliteTable(
  'status_results',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    status: integer('status', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('status_results_name_created_at_idx').on(table.name, table.createdAt),
  ],
)

export type StatusResult = typeof statusResults.$inferSelect
export type NewStatusResult = typeof statusResults.$inferInsert
