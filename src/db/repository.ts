import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'

import type { StatusDb } from './index'
import {
  statusDailySummaries,
  statusResults,
  type NewStatusResult,
  type StatusDaySummary,
  type StatusResult,
} from './schema'
import { dayMs, startOfUtcDay } from '../status/time'

const maxInsertStatementBytes = 90_000
const insertStatusResultsPrefix =
  'insert into "status_results" ("name", "status", "created_at") values '
const insertStatusResultsPrefixBytes = byteLength(insertStatusResultsPrefix)
const tupleSeparator = ', '
const tupleSeparatorBytes = byteLength(tupleSeparator)
const minuteMs = 60 * 1000

export async function insertStatusResults(
  db: StatusDb,
  results: Array<{ name: string; status: boolean }>,
  createdAt = new Date(),
): Promise<void> {
  if (results.length === 0) {
    return
  }

  await insertStatusResultRows(
    db,
    results.map((result) => ({
      name: result.name,
      status: result.status,
      createdAt,
    })),
  )
}

export async function insertStatusResultRows(
  db: StatusDb,
  results: NewStatusResult[],
): Promise<void> {
  if (results.length === 0) {
    return
  }

  let pendingTuples: string[] = []
  let pendingBytes = insertStatusResultsPrefixBytes

  for (const result of results) {
    const tuple = formatStatusResultTuple(result)
    const tupleBytes = byteLength(tuple)

    if (tupleBytes + insertStatusResultsPrefixBytes > maxInsertStatementBytes) {
      await flushStatusResultTuples(db, pendingTuples)
      pendingTuples = []
      pendingBytes = insertStatusResultsPrefixBytes

      await db.insert(statusResults).values(result)
      continue
    }

    const separatorBytes = pendingTuples.length === 0 ? 0 : tupleSeparatorBytes

    if (
      pendingTuples.length > 0 &&
      pendingBytes + separatorBytes + tupleBytes > maxInsertStatementBytes
    ) {
      await flushStatusResultTuples(db, pendingTuples)
      pendingTuples = []
      pendingBytes = insertStatusResultsPrefixBytes
    }

    pendingTuples.push(tuple)
    pendingBytes += (pendingTuples.length === 1 ? 0 : tupleSeparatorBytes) + tupleBytes
  }

  await flushStatusResultTuples(db, pendingTuples)
}

export async function listStatusDaySummaries(
  db: StatusDb,
  names: string[],
  startInclusive: Date,
  endExclusive: Date,
): Promise<StatusDaySummary[]> {
  if (names.length === 0) {
    return []
  }

  return await db
    .select()
    .from(statusDailySummaries)
    .where(
      and(
        gte(statusDailySummaries.dayStartAt, startInclusive),
        lt(statusDailySummaries.dayStartAt, endExclusive),
        inArray(statusDailySummaries.name, names),
      ),
    )
    .orderBy(asc(statusDailySummaries.name), asc(statusDailySummaries.dayStartAt))
}

export async function listStatusResultsBetween(
  db: StatusDb,
  names: string[],
  startInclusive: Date,
  endExclusive?: Date,
): Promise<StatusResult[]> {
  if (names.length === 0) {
    return []
  }

  return await db
    .select()
    .from(statusResults)
    .where(
      endExclusive
        ? and(
            gte(statusResults.createdAt, startInclusive),
            lt(statusResults.createdAt, endExclusive),
            inArray(statusResults.name, names),
          )
        : and(gte(statusResults.createdAt, startInclusive), inArray(statusResults.name, names)),
    )
    .orderBy(asc(statusResults.name), asc(statusResults.createdAt), asc(statusResults.id))
}

export async function listRecentStatusResultsByName(
  db: StatusDb,
  names: string[],
  limit: number,
): Promise<StatusResult[]> {
  if (names.length === 0 || limit < 1) {
    return []
  }

  const rowsByName = await Promise.all(
    names.map((name) =>
      db
        .select()
        .from(statusResults)
        .where(eq(statusResults.name, name))
        .orderBy(desc(statusResults.createdAt), desc(statusResults.id))
        .limit(limit),
    ),
  )

  return rowsByName.flat()
}

export async function hasStoredStatusHistory(
  db: StatusDb,
  names: string[],
): Promise<boolean> {
  if (names.length === 0) {
    return false
  }

  const [rawRows, summaryRows] = await Promise.all([
    db
      .select({ name: statusResults.name })
      .from(statusResults)
      .where(inArray(statusResults.name, names))
      .limit(1),
    db
      .select({ name: statusDailySummaries.name })
      .from(statusDailySummaries)
      .where(inArray(statusDailySummaries.name, names))
      .limit(1),
  ])

  return rawRows.length > 0 || summaryRows.length > 0
}

export async function hasUnsummarizedHistoricalStatusResults(
  db: StatusDb,
  now = new Date(),
): Promise<boolean> {
  const todayStartMs = startOfUtcDay(now).getTime()
  const rows = (await db.all(
    sql.raw(`
      SELECT 1 AS pending
      FROM status_results r
      LEFT JOIN status_daily_summaries s
        ON s.name = r.name
       AND s.day_start_at = ${historicalDayStartSql('r.created_at')}
      WHERE r.created_at < ${todayStartMs}
        AND s.name IS NULL
      LIMIT 1
    `),
  )) as Array<{ pending: number | string | bigint }>

  return rows.length > 0
}

export async function summarizeHistoricalStatusResults(
  db: StatusDb,
  now = new Date(),
  keepRecentRowsPerName = 0,
): Promise<{ summarizedDays: number; deletedRows: number }> {
  const todayStartMs = startOfUtcDay(now).getTime()
  const keepRecentRowsClause = recentRowsKeepClause('r', keepRecentRowsPerName)
  const pendingDays = await queryCount(
    db,
    `
      SELECT COUNT(*) AS count
      FROM (
        SELECT
          r.name,
          ${historicalDayStartSql('r.created_at')} AS day_start_at
        FROM status_results r
        LEFT JOIN status_daily_summaries s
          ON s.name = r.name
         AND s.day_start_at = ${historicalDayStartSql('r.created_at')}
        WHERE r.created_at < ${todayStartMs}
          AND s.name IS NULL
        GROUP BY r.name, day_start_at
      ) pending_days
    `,
  )

  if (pendingDays > 0) {
    await db.run(
      sql.raw(`
        INSERT OR IGNORE INTO status_daily_summaries (
          name,
          day_start_at,
          total_checks,
          down_checks,
          down_minutes,
          latest_status,
          latest_checked_at
        )
        WITH historical_rows AS (
          SELECT
            r.name,
            r.status,
            r.created_at,
            r.id,
            ${historicalDayStartSql('r.created_at')} AS day_start_at,
            LEAD(r.created_at) OVER (
              PARTITION BY r.name, ${historicalDayBucketSql('r.created_at')}
              ORDER BY r.created_at, r.id
            ) AS next_created_at,
            ROW_NUMBER() OVER (
              PARTITION BY r.name, ${historicalDayBucketSql('r.created_at')}
              ORDER BY r.created_at DESC, r.id DESC
            ) AS reverse_position
          FROM status_results r
          WHERE r.created_at < ${todayStartMs}
        )
        SELECT
          hr.name AS name,
          hr.day_start_at AS day_start_at,
          COUNT(*) AS total_checks,
          SUM(CASE WHEN hr.status = 0 THEN 1 ELSE 0 END) AS down_checks,
          CAST(
            (
              SUM(
                CASE
                  WHEN hr.status = 0 THEN
                    MAX(
                      0,
                      MIN(
                        COALESCE(hr.next_created_at, hr.day_start_at + ${dayMs}),
                        hr.day_start_at + ${dayMs}
                      ) - hr.created_at
                    )
                  ELSE 0
                END
              ) + ${minuteMs - 1}
            ) / ${minuteMs} AS INTEGER
          ) AS down_minutes,
          MAX(CASE WHEN hr.reverse_position = 1 THEN hr.status END) AS latest_status,
          MAX(CASE WHEN hr.reverse_position = 1 THEN hr.created_at END) AS latest_checked_at
        FROM historical_rows hr
        LEFT JOIN status_daily_summaries s
          ON s.name = hr.name
         AND s.day_start_at = hr.day_start_at
        WHERE s.name IS NULL
        GROUP BY hr.name, hr.day_start_at
      `),
    )
  }

  const deletedRows = await queryCount(
    db,
    `
      SELECT COUNT(*) AS count
      FROM status_results r
      WHERE r.created_at < ${todayStartMs}
        AND EXISTS (
          SELECT 1
          FROM status_daily_summaries s
          WHERE s.name = r.name
            AND s.day_start_at = ${historicalDayStartSql('r.created_at')}
        )
        ${keepRecentRowsClause}
    `,
  )

  if (deletedRows > 0) {
    await db.run(
      sql.raw(`
        DELETE FROM status_results
        WHERE created_at < ${todayStartMs}
          AND EXISTS (
            SELECT 1
            FROM status_daily_summaries s
            WHERE s.name = status_results.name
              AND s.day_start_at = ${historicalDayStartSql('status_results.created_at')}
          )
          ${recentRowsKeepClause('status_results', keepRecentRowsPerName)}
      `),
    )
  }

  return {
    summarizedDays: pendingDays,
    deletedRows,
  }
}

export async function deleteOldStatusResults(
  db: StatusDb,
  retentionDays: number,
  now = new Date(),
): Promise<void> {
  const cutoff = new Date(now.getTime() - retentionDays * dayMs)

  await db.delete(statusResults).where(lt(statusResults.createdAt, cutoff))
}

export async function deleteOldStatusDaySummaries(
  db: StatusDb,
  retentionDays: number,
  now = new Date(),
): Promise<void> {
  const todayStart = startOfUtcDay(now)
  const cutoff = new Date(todayStart.getTime() - Math.max(retentionDays - 1, 0) * dayMs)

  await db.delete(statusDailySummaries).where(lt(statusDailySummaries.dayStartAt, cutoff))
}

async function flushStatusResultTuples(db: StatusDb, tuples: string[]): Promise<void> {
  if (tuples.length === 0) {
    return
  }

  await db.run(sql.raw(`${insertStatusResultsPrefix}${tuples.join(tupleSeparator)}`))
}

function formatStatusResultTuple(result: NewStatusResult): string {
  const createdAt = result.createdAt.getTime()

  if (!Number.isFinite(createdAt)) {
    throw new Error(`Invalid createdAt value for status result "${result.name}".`)
  }

  return `(${sqliteString(result.name)}, ${result.status ? 1 : 0}, ${Math.trunc(createdAt)})`
}

function sqliteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

async function queryCount(db: StatusDb, query: string): Promise<number> {
  const rows = (await db.all(sql.raw(query))) as Array<{ count: number | string | bigint }>
  return Number(rows[0]?.count ?? 0)
}

function historicalDayBucketSql(createdAtSql: string): string {
  return `CAST(${createdAtSql} / ${dayMs} AS INTEGER)`
}

function historicalDayStartSql(createdAtSql: string): string {
  return `${historicalDayBucketSql(createdAtSql)} * ${dayMs}`
}

function recentRowsKeepClause(rowReference: string, keepRecentRowsPerName: number): string {
  const keepCount = Math.max(0, Math.floor(keepRecentRowsPerName))

  if (keepCount === 0) {
    return ''
  }

  return `
        AND ${rowReference}.id NOT IN (
          SELECT recent.id
          FROM (
            SELECT
              r.id,
              ROW_NUMBER() OVER (
                PARTITION BY r.name
                ORDER BY r.created_at DESC, r.id DESC
              ) AS recent_position
            FROM status_results r
          ) recent
          WHERE recent.recent_position <= ${keepCount}
        )`
}
