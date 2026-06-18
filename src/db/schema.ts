import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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

export const statusDailySummaries = sqliteTable(
  'status_daily_summaries',
  {
    name: text('name').notNull(),
    dayStartAt: integer('day_start_at', { mode: 'timestamp_ms' }).notNull(),
    totalChecks: integer('total_checks').notNull(),
    downChecks: integer('down_checks').notNull(),
    downMinutes: integer('down_minutes').notNull(),
    latestStatus: integer('latest_status', { mode: 'boolean' }).notNull(),
    latestCheckedAt: integer('latest_checked_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.name, table.dayStartAt] }),
    index('status_daily_summaries_day_start_at_idx').on(table.dayStartAt),
  ],
)

export type StatusResult = typeof statusResults.$inferSelect
export type NewStatusResult = typeof statusResults.$inferInsert
export type StatusDaySummary = typeof statusDailySummaries.$inferSelect
export type NewStatusDaySummary = typeof statusDailySummaries.$inferInsert
