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

const DEFAULT_SOCIAL_IMAGE_PATH = '/paragraphcms-open-soruce-status-page.jpg'
const DEFAULT_TWITTER_CARD = 'summary_large_image'

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

export function getMeta(env: AppEnv, pageUrl: string | URL): MetaEntry[] {
  const resolvedPageUrl = typeof pageUrl === 'string' ? new URL(pageUrl) : pageUrl
  const parsed = parseJsonArray(env.META)
  const configured = parsed.flatMap((entry) => {
    if (!isPlainObject(entry)) {
      return []
    }

    const name = nonEmptyString(entry.name)
    const value = nonEmptyString(entry.value)

    if (!name || !value) {
      return []
    }

    return [
      {
        name,
        value: normalizeMetaValue(name, value, resolvedPageUrl),
      },
    ]
  })
  const configuredNames = new Set(configured.map((entry) => entry.name))
  const fallbackImageUrl = new URL(DEFAULT_SOCIAL_IMAGE_PATH, resolvedPageUrl).toString()
  const defaults: MetaEntry[] = []

  if (!configuredNames.has('og:image')) {
    defaults.push({
      name: 'og:image',
      value: fallbackImageUrl,
    })
  }

  if (!configuredNames.has('twitter:image')) {
    defaults.push({
      name: 'twitter:image',
      value: fallbackImageUrl,
    })
  }

  if (!configuredNames.has('twitter:card')) {
    defaults.push({
      name: 'twitter:card',
      value: DEFAULT_TWITTER_CARD,
    })
  }

  return [...configured, ...defaults]
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

function normalizeMetaValue(name: string, value: string, pageUrl: URL): string {
  if (
    (name === 'og:image' || name === 'twitter:image' || name === 'og:url') &&
    value.startsWith('/')
  ) {
    return new URL(value, pageUrl).toString()
  }

  return value
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
