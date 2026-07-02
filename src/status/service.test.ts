import { afterEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'

import { schema, type StatusDb } from '../db'
import { insertStatusResultRows } from '../db/repository'
import type { AppEnv } from '../env'
import { getSlackStatusSummary, runConfiguredChecks } from './service'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('Slack summary ignores non-consecutive failures in the latest check window', async () => {
  const db = createTestDb()
  const slackRequests: string[] = []
  const env = createEnv(captureSlackFetch(slackRequests))

  await insertStatusResultRows(db, [
    statusRow('API', true, 0),
    statusRow('API', false, 1),
    statusRow('API', false, 2),
  ])

  const summary = await getSlackStatusSummary(env, db, dateAt(3))

  expect(summary.status).toBe(true)
  expect(summary.failures).toHaveLength(0)
  expect(summary.notificationSent).toBe(false)
  expect(slackRequests).toHaveLength(0)
})

test('configured checks notify Slack when the latest checks are consecutive failures', async () => {
  const db = createTestDb()
  const slackRequests: string[] = []
  const env = createEnv(captureSlackFetch(slackRequests))

  await insertStatusResultRows(db, [
    statusRow('API', false, 0),
    statusRow('API', false, 1),
  ])

  const summary = await runConfiguredChecks(env, db, dateAt(2))

  expect(summary.status).toBe(false)
  expect(summary.slack.notificationSent).toBe(true)
  expect(summary.slack.failures.map((failure) => failure.name)).toEqual(['API'])
  expect(summary.slack.failures[0]?.failedChecks).toHaveLength(3)
  expect(slackRequests).toHaveLength(1)
  expect(expectSlackPayload(slackRequests[0])).toMatchObject({
    text: expect.stringContaining('🚨 Service Health Alert'),
  })
})

test('configured checks keep previous-day failures available for Slack threshold checks', async () => {
  const db = createTestDb()
  const slackRequests: string[] = []
  const env = createEnv(captureSlackFetch(slackRequests))

  await insertStatusResultRows(db, [
    statusRowAt('API', false, new Date(Date.UTC(2026, 0, 1, 23, 50, 0))),
    statusRowAt('API', false, new Date(Date.UTC(2026, 0, 1, 23, 55, 0))),
  ])

  const summary = await runConfiguredChecks(env, db, new Date(Date.UTC(2026, 0, 2, 0, 0, 0)))

  expect(summary.status).toBe(false)
  expect(summary.slack.notificationSent).toBe(true)
  expect(summary.slack.failures[0]?.failedChecks).toHaveLength(3)
  expect(slackRequests).toHaveLength(1)
  expect(expectSlackPayload(slackRequests[0]).text).toContain(
    'Failure history:\n• 2026-01-01 23:50 UTC\n• 2026-01-01 23:55 UTC\n• 2026-01-02 00:00 UTC',
  )
})

test('Slack payload uses structured sections for HTTP failures', async () => {
  const db = createTestDb()
  const slackRequests: string[] = []
  const env = createEnv(captureSlackFetch(slackRequests), [
    {
      name: 'Issuer Portal',
      type: 'http',
      url: 'https://credentials.codedevs.pro/credentials/678c5257-21f6-4e2a-baed-5b39b79a44cd?preview=1',
      method: 'GET',
      expectedStatus: [200],
      timeoutMs: 50,
      softFail: false,
      softFailMilliseconds: 500,
    },
    {
      name: 'App',
      type: 'tcp',
      host: '127.0.0.1',
      port: 1,
      timeoutMs: 50,
    },
  ])

  await insertStatusResultRows(db, [
    statusRow('Issuer Portal', false, 0),
    statusRow('Issuer Portal', false, 1),
    statusRow('Issuer Portal', false, 2),
    statusRow('App', false, 0),
    statusRow('App', false, 1),
    statusRow('App', false, 2),
  ])

  const summary = await getSlackStatusSummary(env, db, dateAt(2))
  const payload = expectSlackPayload(slackRequests[0])

  expect(summary.notificationSent).toBe(true)
  expect(slackRequests).toHaveLength(1)
  expect(payload.text).toContain('🚨 Service Health Alert')
  expect(payload.text).toContain('Status: DOWN')
  expect(payload.text).toContain('Services: Issuer Portal, App')
  expect(payload.text).toContain('Issuer Portal')
  expect(payload.text).toContain('Check type:\nHTTP')
  expect(payload.text).toContain(
    'URL:\nhttps://credentials.codedevs.pro/credentials/678c5257-21f6-4e2a-baed-5b39b79a44cd?preview=1',
  )
  expect(payload.text).toContain('Expected:\nHTTP 200')
  expect(payload.text).toContain('Failure history:\n• 00:00 UTC\n• 00:01 UTC\n• 00:02 UTC')
  expect(payload.blocks.some((block) => block.type === 'header')).toBe(true)
})

function createTestDb(): StatusDb {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE status_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX status_results_name_created_at_idx
      ON status_results (name, created_at);
    CREATE TABLE status_daily_summaries (
      name TEXT NOT NULL,
      day_start_at INTEGER NOT NULL,
      total_checks INTEGER NOT NULL,
      down_checks INTEGER NOT NULL,
      down_minutes INTEGER NOT NULL,
      latest_status INTEGER NOT NULL,
      latest_checked_at INTEGER NOT NULL,
      PRIMARY KEY (name, day_start_at)
    );
    CREATE INDEX status_daily_summaries_day_start_at_idx
      ON status_daily_summaries (day_start_at);
  `)

  return drizzle(sqlite, { schema })
}

function createEnv(
  slackWebhookUrl: string,
  statusEndpointsJson: AppEnv['STATUS_ENDPOINTS_JSON'] = [
    {
      name: 'API',
      type: 'tcp',
      host: '127.0.0.1',
      port: 1,
      timeoutMs: 50,
    },
  ],
): AppEnv {
  return {
    SLACK_WEBHOOK_URL: slackWebhookUrl,
    SLACK_STATUS_CHECK_COUNT: 3,
    STATUS_ENDPOINTS_JSON: statusEndpointsJson,
  }
}

function statusRow(name: string, status: boolean, minuteOffset: number) {
  return statusRowAt(name, status, dateAt(minuteOffset))
}

function statusRowAt(name: string, status: boolean, createdAt: Date) {
  return {
    name,
    status,
    createdAt,
  }
}

function dateAt(minuteOffset: number): Date {
  return new Date(Date.UTC(2026, 0, 1, 0, minuteOffset, 0))
}

function captureSlackFetch(requests: string[]): string {
  const slackWebhookUrl = 'https://slack.test/webhook'
  const slackFetch = Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): ReturnType<typeof fetch> => {
      const url =
        typeof input === 'string' || input instanceof URL
          ? input.toString()
          : input.url

      if (url === slackWebhookUrl) {
        requests.push(typeof init?.body === 'string' ? init.body : '')
        return new Response('ok')
      }

      return await originalFetch(input, init)
    },
    { preconnect: originalFetch.preconnect },
  )

  globalThis.fetch = slackFetch

  return slackWebhookUrl
}

function expectSlackPayload(raw: string | undefined): {
  text: string
  blocks: Array<{ type: string }>
} {
  return JSON.parse(raw ?? '{}')
}
