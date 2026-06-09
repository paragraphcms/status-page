import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm'

import type { StatusDb } from './index'
import { statusResults, type NewStatusResult, type StatusResult } from './schema'

const dayMs = 24 * 60 * 60 * 1000
const insertBatchSize = 200

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

  for (let index = 0; index < results.length; index += insertBatchSize) {
    await db.insert(statusResults).values(results.slice(index, index + insertBatchSize))
  }
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
