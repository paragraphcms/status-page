import type { StatusDb } from './db'

export type AppEnv = {
  DB?: D1Database
  STATUS_ENDPOINTS_JSON?: string | unknown[]
  LOGO_URL?: string
  FAVICON_URL?: string
  META?: string | unknown[]
  RETENTION_DAYS?: string | number
  MOCK_PREVIOUS_DAYS?: string | number
  DISPLAY_DAYS?: string | number
  PAGE_TITLE?: string
  FOOTER_TITLE?: string
  CLEANUP_CRON?: string
  SLACK_WEBHOOK_URL?: string
  SLACK_STATUS_CHECK_COUNT?: string | number
}

export type MetaEntry = {
  name: string
  value: string
}

export type AppRuntime = {
  getDb(env: AppEnv): StatusDb
  now?(): Date
}

export function getRetentionDays(raw: AppEnv['RETENTION_DAYS']): number {
  return readPositiveInteger(raw, 90, 365)
}

export function getDisplayDays(
  raw: AppEnv['DISPLAY_DAYS'],
  retentionDays: number,
): number {
  return Math.min(readPositiveInteger(raw, 60, 365), retentionDays)
}

export function getMockPreviousDaysPercent(
  raw: AppEnv['MOCK_PREVIOUS_DAYS'],
): number | undefined {
  if (raw === undefined || raw === null || raw === '') {
    return undefined
  }

  const normalized = typeof raw === 'number' ? String(raw) : raw.trim().replace(',', '.')
  const parsed = Number.parseFloat(normalized)

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return undefined
  }

  return parsed
}

export function getSlackStatusCheckCount(raw: AppEnv['SLACK_STATUS_CHECK_COUNT']): number {
  return readPositiveInteger(raw, 3, 100)
}

export function getSlackWebhookUrl(env: AppEnv): string | undefined {
  return nonEmptyString(env.SLACK_WEBHOOK_URL)
}

export function getPageTitle(env: AppEnv): string {
  return nonEmptyString(env.PAGE_TITLE) ?? 'Status Page'
}

export function getFooterTitle(env: AppEnv): string {
  return nonEmptyString(env.FOOTER_TITLE) ?? 'Paragraph CMS Open Status Page'
}

export function getLogoUrl(env: AppEnv): string | undefined {
  return nonEmptyString(env.LOGO_URL)
}

export function getFaviconUrl(env: AppEnv): string | undefined {
  return nonEmptyString(env.FAVICON_URL)
}

export function getMeta(env: AppEnv): MetaEntry[] {
  const parsed = parseJsonArray(env.META)

  return parsed.flatMap((entry) => {
    if (!isPlainObject(entry)) {
      return []
    }

    const name = nonEmptyString(entry.name)

    if (!name || typeof entry.value !== 'string') {
      return []
    }

    return [
      {
        name,
        value: entry.value.trim(),
      },
    ]
  })
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function parseJsonArray(raw: unknown): unknown[] {
  if (raw === undefined || raw === null || raw === '') {
    return []
  }

  if (Array.isArray(raw)) {
    return raw
  }

  if (typeof raw !== 'string') {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPositiveInteger(raw: unknown, fallback: number, max: number): number {
  if (raw === undefined || raw === null || raw === '') {
    return fallback
  }

  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10)

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback
  }

  return Math.min(Math.floor(parsed), max)
}
