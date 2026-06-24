import {
  deleteOldStatusDaySummaries,
  deleteOldStatusResults,
  hasStoredStatusHistory,
  hasUnsummarizedHistoricalStatusResults,
  insertStatusResultRows,
  insertStatusResults,
  listStatusDaySummaries,
  listRecentStatusResultsByName,
  listStatusResultsBetween,
  summarizeHistoricalStatusResults,
} from '../db/repository'
import type { StatusDb } from '../db'
import type { NewStatusResult, StatusResult } from '../db/schema'
import type { AppEnv } from '../env'
import {
  getDisplayDays,
  getMockPreviousDaysPercent,
  getRetentionDays,
  getSlackStatusCheckCount,
  getSlackWebhookUrl,
} from '../env'
import { runStatusCheck } from './checks'
import { parseStatusEndpoints, type StatusCheckConfig } from './config'
import {
  buildStatusSnapshot,
  type RunSlackStatus,
  type RunSummary,
  type StatusSnapshot,
} from './snapshot'
import { dayMs, startOfUtcDay } from './time'

const mockCheckIntervalMs = 5 * 60 * 1000

type SlackStatusCheck = {
  status: boolean
  checkedAt: Date
}

type SlackStatusConfigDetails = Record<string, string | number | boolean | number[]>

type SlackStatusMonitor = {
  name: string
  type: StatusCheckConfig['type']
  description?: string
  status: boolean | null
  failed: boolean
  checks: SlackStatusCheck[]
}

type SlackStatusFailure = {
  name: string
  type: StatusCheckConfig['type']
  description?: string
  config: SlackStatusConfigDetails
  failedChecks: SlackStatusCheck[]
}

export type SlackStatusSummary = {
  checkedAt: Date
  status: boolean
  checkCount: number
  slackConfigured: boolean
  notificationSent: boolean
  notificationError?: string
  monitors: SlackStatusMonitor[]
  failures: SlackStatusFailure[]
  configErrors: string[]
}

export async function runConfiguredChecks(
  env: AppEnv,
  db: StatusDb,
  now = new Date(),
): Promise<RunSummary> {
  const parsed = parseStatusEndpoints(env.STATUS_ENDPOINTS_JSON)
  const retentionDays = getRetentionDays(env.RETENTION_DAYS)
  await ensureHistoricalStatusCompaction(env, db, parsed.configs, retentionDays, now)

  const results = await Promise.all(parsed.configs.map((config) => runStatusCheck(config, now)))

  await insertStatusResults(
    db,
    results.map((result) => ({
      name: result.name,
      status: result.status,
    })),
    now,
  )

  const slackStatus = await getSlackStatusSummaryForConfigs(
    env,
    db,
    parsed.configs,
    parsed.errors,
    now,
  )

  return {
    checkedAt: now,
    status:
      parsed.configs.length > 0 &&
      parsed.errors.length === 0 &&
      results.every((result) => result.status),
    results,
    slack: toRunSlackStatus(slackStatus),
    configErrors: parsed.errors,
  }
}

export async function getStatusSnapshot(
  env: AppEnv,
  db: StatusDb,
  now = new Date(),
): Promise<StatusSnapshot> {
  const parsed = parseStatusEndpoints(env.STATUS_ENDPOINTS_JSON)
  const publicConfigs = parsed.configs.filter((config) => !config.private)
  const retentionDays = getRetentionDays(env.RETENTION_DAYS)
  const displayDays = getDisplayDays(env.DISPLAY_DAYS, retentionDays)
  const todayStart = startOfUtcDay(now)
  const displayStart = new Date(todayStart.getTime() - Math.max(displayDays - 1, 0) * dayMs)
  await ensureHistoricalStatusCompaction(env, db, publicConfigs, retentionDays, now)

  const names = publicConfigs.map((config) => config.name)
  const [historicalSummaries, todayRows] = await Promise.all([
    displayDays > 1
      ? listStatusDaySummaries(db, names, displayStart, todayStart)
      : Promise.resolve([]),
    listStatusResultsBetween(db, names, todayStart),
  ])

  return buildStatusSnapshot(
    publicConfigs,
    todayRows,
    historicalSummaries,
    retentionDays,
    displayDays,
    now,
    parsed.errors,
  )
}

export async function getSlackStatusSummary(
  env: AppEnv,
  db: StatusDb,
  now = new Date(),
): Promise<SlackStatusSummary> {
  const parsed = parseStatusEndpoints(env.STATUS_ENDPOINTS_JSON)

  return await getSlackStatusSummaryForConfigs(env, db, parsed.configs, parsed.errors, now)
}

async function getSlackStatusSummaryForConfigs(
  env: AppEnv,
  db: StatusDb,
  configs: StatusCheckConfig[],
  configErrors: string[],
  now: Date,
): Promise<SlackStatusSummary> {
  const checkCount = getSlackStatusCheckCount(env.SLACK_STATUS_CHECK_COUNT)
  const webhookUrl = getSlackWebhookUrl(env)
  const recentRows = await listRecentStatusResultsByName(
    db,
    configs.map((config) => config.name),
    checkCount,
  )
  const rowsByName = groupRowsByName(recentRows)
  const monitors: SlackStatusMonitor[] = []
  const failures: SlackStatusFailure[] = []

  for (const config of configs) {
    const checks = (rowsByName.get(config.name) ?? []).map(rowToSlackStatusCheck)
    const consecutiveFailedChecks = leadingFailedChecks(checks)
    const failed = consecutiveFailedChecks.length >= checkCount

    monitors.push({
      name: config.name,
      type: config.type,
      description: config.description,
      status: checks.at(0)?.status ?? null,
      failed,
      checks,
    })

    if (failed) {
      failures.push({
        name: config.name,
        type: config.type,
        description: config.description,
        config: configDetails(config),
        failedChecks: consecutiveFailedChecks,
      })
    }
  }

  let notificationSent = false
  let notificationError: string | undefined

  if (failures.length > 0) {
    if (!webhookUrl) {
      notificationError = 'Missing SLACK_WEBHOOK_URL.'
    } else {
      const notification = await sendSlackStatusNotification(
        webhookUrl,
        failures,
        now,
        checkCount,
      )
      notificationSent = notification.sent
      notificationError = notification.error
    }
  }

  return {
    checkedAt: now,
    status:
      configs.length > 0 &&
      configErrors.length === 0 &&
      monitors.every((monitor) => monitor.checks.length > 0 && !monitor.failed),
    checkCount,
    slackConfigured: webhookUrl !== undefined,
    notificationSent,
    notificationError,
    monitors,
    failures,
    configErrors,
  }
}

function toRunSlackStatus(summary: SlackStatusSummary): RunSlackStatus {
  return {
    checkCount: summary.checkCount,
    slackConfigured: summary.slackConfigured,
    notificationSent: summary.notificationSent,
    notificationError: summary.notificationError,
    failures: summary.failures.map((failure) => ({
      name: failure.name,
      type: failure.type,
      description: failure.description,
      failedChecks: failure.failedChecks,
    })),
  }
}

export async function cleanupOldResults(
  env: AppEnv,
  db: StatusDb,
  now = new Date(),
): Promise<{ retentionDays: number }> {
  const retentionDays = getRetentionDays(env.RETENTION_DAYS)
  await Promise.all([
    deleteOldStatusResults(db, retentionDays, now),
    deleteOldStatusDaySummaries(db, retentionDays, now),
  ])

  return { retentionDays }
}

export async function summarizeStatusHistory(
  env: AppEnv,
  db: StatusDb,
  now = new Date(),
): Promise<{ summarizedDays: number; deletedRows: number }> {
  const parsed = parseStatusEndpoints(env.STATUS_ENDPOINTS_JSON)
  const retentionDays = getRetentionDays(env.RETENTION_DAYS)
  await mockPreviousDaysIfNeeded(env, db, parsed.configs, retentionDays, now)

  return await summarizeHistoricalStatusResults(
    db,
    now,
    getSlackStatusCheckCount(env.SLACK_STATUS_CHECK_COUNT),
  )
}

async function mockPreviousDaysIfNeeded(
  env: AppEnv,
  db: StatusDb,
  configs: StatusCheckConfig[],
  retentionDays: number,
  now: Date,
): Promise<boolean> {
  const successPercent = getMockPreviousDaysPercent(env.MOCK_PREVIOUS_DAYS)

  if (successPercent === undefined || configs.length === 0) {
    return false
  }

  const names = configs.map((config) => config.name)
  const hasHistory = await hasStoredStatusHistory(db, names)

  if (hasHistory) {
    return false
  }

  await insertStatusResultRows(
    db,
    buildMockStatusRows(names, retentionDays, successPercent, now),
  )

  return true
}

async function ensureHistoricalStatusCompaction(
  env: AppEnv,
  db: StatusDb,
  configs: StatusCheckConfig[],
  retentionDays: number,
  now: Date,
): Promise<void> {
  const mockedHistory = await mockPreviousDaysIfNeeded(env, db, configs, retentionDays, now)

  if (mockedHistory || (await hasUnsummarizedHistoricalStatusResults(db, now))) {
    await summarizeHistoricalStatusResults(
      db,
      now,
      getSlackStatusCheckCount(env.SLACK_STATUS_CHECK_COUNT),
    )
  }
}

function buildMockStatusRows(
  names: string[],
  retentionDays: number,
  successPercent: number,
  now: Date,
): NewStatusResult[] {
  const cutoff = now.getTime() - retentionDays * dayMs
  const startsAt = Math.ceil(cutoff / mockCheckIntervalMs) * mockCheckIntervalMs
  const endsBefore = Math.floor(now.getTime() / mockCheckIntervalMs) * mockCheckIntervalMs
  const sampleCount = Math.max(0, Math.floor((endsBefore - startsAt) / mockCheckIntervalMs))

  if (sampleCount === 0) {
    return []
  }

  return names.flatMap((name) => {
    const downIndexes = buildMockDownIndexes(sampleCount, successPercent, name)

    return Array.from({ length: sampleCount }, (_, index) => ({
      name,
      status: !downIndexes.has(index),
      createdAt: new Date(startsAt + index * mockCheckIntervalMs),
    }))
  })
}

function buildMockDownIndexes(
  sampleCount: number,
  successPercent: number,
  name: string,
): Set<number> {
  const downCount = sampleCount - Math.round((sampleCount * successPercent) / 100)
  const downIndexes = new Set<number>()

  if (downCount <= 0) {
    return downIndexes
  }

  if (downCount >= sampleCount) {
    return new Set(Array.from({ length: sampleCount }, (_, index) => index))
  }

  const offset = hashString(name) % sampleCount

  for (let index = 0; index < downCount; index += 1) {
    let downIndex = (Math.floor(((index + 0.5) * sampleCount) / downCount) + offset) % sampleCount

    while (downIndexes.has(downIndex)) {
      downIndex = (downIndex + 1) % sampleCount
    }

    downIndexes.add(downIndex)
  }

  return downIndexes
}

function hashString(value: string): number {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }

  return hash
}

function groupRowsByName(rows: StatusResult[]): Map<string, StatusResult[]> {
  const byName = new Map<string, StatusResult[]>()

  for (const row of rows) {
    const current = byName.get(row.name) ?? []
    current.push(row)
    byName.set(row.name, current)
  }

  return byName
}

function rowToSlackStatusCheck(row: StatusResult): SlackStatusCheck {
  return {
    status: row.status,
    checkedAt: row.createdAt,
  }
}

function leadingFailedChecks(checks: SlackStatusCheck[]): SlackStatusCheck[] {
  const failedChecks: SlackStatusCheck[] = []

  for (const check of checks) {
    if (check.status) {
      break
    }

    failedChecks.push(check)
  }

  return failedChecks
}

async function sendSlackStatusNotification(
  webhookUrl: string,
  failures: SlackStatusFailure[],
  checkedAt: Date,
  checkCount: number,
): Promise<{ sent: boolean; error?: string }> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: buildSlackStatusMessage(failures, checkedAt, checkCount),
      }),
    })

    if (!response.ok) {
      return {
        sent: false,
        error: `Slack webhook returned HTTP ${response.status}.`,
      }
    }

    return { sent: true }
  } catch (error) {
    return { sent: false, error: errorMessage(error) }
  }
}

function buildSlackStatusMessage(
  failures: SlackStatusFailure[],
  checkedAt: Date,
  checkCount: number,
): string {
  const failureText = failures
    .map((failure) =>
      [
        `*${escapeSlackText(failure.name)}* (${failure.type})`,
        failure.description
          ? `Description: ${escapeSlackText(failure.description)}`
          : undefined,
        `Config: ${escapeSlackText(formatConfigDetails(failure.config))}`,
        `Consecutive failed checks: ${failure.failedChecks
          .map((check) => check.checkedAt.toISOString())
          .join(', ')}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join('\n'),
    )
    .join('\n\n')

  return [
    '*Status page alert*',
    `Detected ${checkCount} consecutive failed check(s) for one or more monitors.`,
    `Checked at: ${checkedAt.toISOString()}`,
    '',
    failureText,
  ].join('\n')
}

function configDetails(config: StatusCheckConfig): SlackStatusConfigDetails {
  switch (config.type) {
    case 'http': {
      const details: SlackStatusConfigDetails = {
        method: config.method,
        url: config.url,
        expectedStatus: config.expectedStatus,
        timeoutMs: config.timeoutMs,
      }

      if (config.softFail) {
        details.softFail = true
        details.softFailMilliseconds = config.softFailMilliseconds
      }

      if (config.expectedBodyIncludes) {
        details.expectedBodyIncludes = config.expectedBodyIncludes
      }

      if (config.expectedBodyExcludes) {
        details.expectedBodyExcludes = config.expectedBodyExcludes
      }

      if (config.headers && Object.keys(config.headers).length > 0) {
        details.headers = formatRedactedHeaders(config.headers)
      }

      return details
    }
    case 'ssl':
      return {
        host: config.host,
        port: config.port,
        warnBeforeDays: config.warnBeforeDays,
        timeoutMs: config.timeoutMs,
      }
    case 'tcp':
      return {
        host: config.host,
        port: config.port,
        timeoutMs: config.timeoutMs,
      }
    case 'dns':
      return {
        host: config.host,
        recordType: config.recordType,
        timeoutMs: config.timeoutMs,
      }
  }
}

function formatConfigDetails(details: SlackStatusConfigDetails): string {
  return Object.entries(details)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)
    .join(', ')
}

function formatRedactedHeaders(headers: Record<string, string>): string {
  return Object.keys(headers)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => `${name}: [redacted]`)
    .join(', ')
}

function escapeSlackText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
