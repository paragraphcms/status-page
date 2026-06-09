import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'

import type { StatusDb } from './index'
import { statusResults, type NewStatusResult, type StatusResult } from './schema'

const dayMs = 24 * 60 * 60 * 1000
const maxInsertStatementBytes = 90_000
const insertStatusResultsPrefix =
  'insert into "status_results" ("name", "status", "created_at") values '
const insertStatusResultsPrefixBytes = byteLength(insertStatusResultsPrefix)
const tupleSeparator = ', '
const tupleSeparatorBytes = byteLength(tupleSeparator)

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

export async function listStatusHistory(
  db: StatusDb,
  names: string[],
  retentionDays: number,
  now = new Date(),
): Promise<StatusResult[]> {
  if (names.length === 0) {
    return []
  }

  const cutoff = new Date(now.getTime() - retentionDays * dayMs)

  return await db
    .select()
    .from(statusResults)
    .where(and(gte(statusResults.createdAt, cutoff), inArray(statusResults.name, names)))
    .orderBy(asc(statusResults.createdAt))
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

export async function deleteOldStatusResults(
  db: StatusDb,
  retentionDays: number,
  now = new Date(),
): Promise<void> {
  const cutoff = new Date(now.getTime() - retentionDays * dayMs)

  await db.delete(statusResults).where(lt(statusResults.createdAt, cutoff))
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
