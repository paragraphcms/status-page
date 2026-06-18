import type { StatusDaySummary, StatusResult } from '../db/schema'
import type { CheckOutcome } from './checks'
import type { StatusCheckConfig } from './config'
import { dayMs, minuteMs, startOfUtcDay } from './time'

const defaultCheckIntervalMs = 5 * minuteMs

export type DayStatus = 'up' | 'down' | 'empty'

export type MonitorSnapshot = {
  name: string
  type: StatusCheckConfig['type']
  description?: string
  latestStatus: boolean | null
  latestCheckedAt: Date | null
  uptimePercent: number | null
  days: Array<{
    key: string
    label: string
    status: DayStatus
    tooltip: string
    totalChecks: number
    downChecks: number
    downMinutes: number
    downPercent: number
  }>
}

export type StatusSnapshot = {
  generatedAt: Date
  retentionDays: number
  displayDays: number
  monitors: MonitorSnapshot[]
  operational: boolean
  hasConfig: boolean
  hasData: boolean
  configErrors: string[]
}

export type RunSummary = {
  checkedAt: Date
  status: boolean
  results: CheckOutcome[]
  configErrors: string[]
}

export function buildStatusSnapshot(
  configs: StatusCheckConfig[],
  todayRows: StatusResult[],
  historicalSummaries: StatusDaySummary[],
  retentionDays: number,
  displayDays: number,
  generatedAt: Date,
  configErrors: string[],
): StatusSnapshot {
  const rowsByName = groupRowsByName(todayRows)
  const summariesByName = groupSummariesByName(historicalSummaries)
  const days = buildDayRange(displayDays, generatedAt)

  const monitors = configs.map((config) => {
    const history = rowsByName.get(config.name) ?? []
    const summaries = summariesByName.get(config.name) ?? []
    const latestRow = history.at(-1) ?? null
    const latestSummary = summaries.at(-1) ?? null
    const latest =
      latestRow &&
      (!latestSummary ||
        latestRow.createdAt.getTime() >= latestSummary.latestCheckedAt.getTime())
        ? { status: latestRow.status, checkedAt: latestRow.createdAt }
        : latestSummary
          ? { status: latestSummary.latestStatus, checkedAt: latestSummary.latestCheckedAt }
          : null
    const total =
      history.length + summaries.reduce((sum, summary) => sum + summary.totalChecks, 0)
    const up =
      history.filter((row) => row.status).length +
      summaries.reduce((sum, summary) => sum + (summary.totalChecks - summary.downChecks), 0)
    const summariesByDay = new Map(
      summaries.map((summary) => [summary.dayStartAt.getTime(), summary]),
    )

    return {
      name: config.name,
      type: config.type,
      description: config.description,
      latestStatus: latest?.status ?? null,
      latestCheckedAt: latest?.checkedAt ?? null,
      uptimePercent: total > 0 ? (up / total) * 100 : null,
      days: days.map((day) => {
        const summary = summariesByDay.get(day.startsAt.getTime())

        if (summary) {
          const status =
            summary.totalChecks === 0 && summary.downMinutes === 0
              ? 'empty'
              : summary.downChecks === 0 && summary.downMinutes === 0
                ? 'up'
                : 'down'

          return {
            key: day.key,
            label: day.label,
            status,
            tooltip: formatDayTooltip(day.longLabel, status, summary.downMinutes),
            totalChecks: summary.totalChecks,
            downChecks: summary.downChecks,
            downMinutes: summary.downMinutes,
            downPercent: calculateDownPercent(
              summary.totalChecks,
              summary.downChecks,
              summary.downMinutes,
              day.startsAt,
              day.endsAt,
              generatedAt,
            ),
          }
        }

        const dayRows = history.filter(
          (row) =>
            row.createdAt.getTime() >= day.startsAt.getTime() &&
            row.createdAt.getTime() < day.endsAt.getTime(),
        )
        const downChecks = dayRows.filter((row) => !row.status).length
        const downMinutes = calculateDownMinutes(history, day.startsAt, day.endsAt, generatedAt)
        const status =
          dayRows.length === 0 && downMinutes === 0
            ? 'empty'
            : downChecks === 0 && downMinutes === 0
              ? 'up'
              : 'down'

        return {
          key: day.key,
          label: day.label,
          status,
          tooltip: formatDayTooltip(day.longLabel, status, downMinutes),
          totalChecks: dayRows.length,
          downChecks,
          downMinutes,
          downPercent: calculateDownPercent(
            dayRows.length,
            downChecks,
            downMinutes,
            day.startsAt,
            day.endsAt,
            generatedAt,
          ),
        }
      }),
    } satisfies MonitorSnapshot
  })

  const hasData = monitors.some((monitor) => monitor.latestStatus !== null)
  const operational =
    configs.length > 0 &&
    configErrors.length === 0 &&
    monitors.every((monitor) => monitor.latestStatus === true)

  return {
    generatedAt,
    retentionDays,
    displayDays,
    monitors,
    operational,
    hasConfig: configs.length > 0,
    hasData,
    configErrors,
  }
}

function groupRowsByName(rows: StatusResult[]): Map<string, StatusResult[]> {
  const byName = new Map<string, StatusResult[]>()

  for (const row of rows) {
    const current = byName.get(row.name) ?? []
    current.push(row)
    byName.set(row.name, current)
  }

  for (const rows of byName.values()) {
    rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  return byName
}

function groupSummariesByName(
  rows: StatusDaySummary[],
): Map<string, StatusDaySummary[]> {
  const byName = new Map<string, StatusDaySummary[]>()

  for (const row of rows) {
    const current = byName.get(row.name) ?? []
    current.push(row)
    byName.set(row.name, current)
  }

  for (const summaries of byName.values()) {
    summaries.sort((a, b) => a.dayStartAt.getTime() - b.dayStartAt.getTime())
  }

  return byName
}

function buildDayRange(dayCount: number, now: Date) {
  const today = startOfUtcDay(now)

  return Array.from({ length: dayCount }, (_, index) => {
    const startsAt = new Date(today.getTime() - (dayCount - index - 1) * dayMs)
    const endsAt = new Date(startsAt.getTime() + dayMs)

    return {
      startsAt,
      endsAt,
      key: startsAt.toISOString().slice(0, 10),
      label: startsAt.toLocaleDateString('en', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }),
      longLabel: formatLongUtcDate(startsAt),
    }
  })
}

function calculateDownMinutes(
  rows: StatusResult[],
  dayStartsAt: Date,
  dayEndsAt: Date,
  now: Date,
): number {
  const dayStart = dayStartsAt.getTime()
  const dayEnd = dayEndsAt.getTime()
  const checkInterval = inferCheckInterval(rows)
  let downMs = 0

  rows.forEach((row, index) => {
    if (row.status) {
      return
    }

    const startsAt = row.createdAt.getTime()
    const next = rows[index + 1]
    const endsAt = next?.createdAt.getTime() ?? Math.max(now.getTime(), startsAt + checkInterval)
    const overlapStart = Math.max(startsAt, dayStart)
    const overlapEnd = Math.min(endsAt, dayEnd)

    if (overlapEnd > overlapStart) {
      downMs += overlapEnd - overlapStart
    }
  })

  return Math.ceil(downMs / minuteMs)
}

function calculateDownPercent(
  totalChecks: number,
  downChecks: number,
  downMinutes: number,
  dayStartsAt: Date,
  dayEndsAt: Date,
  now: Date,
): number {
  if (totalChecks > 0 && downChecks > 0) {
    return clampPercent((downChecks / totalChecks) * 100)
  }

  if (downMinutes > 0) {
    const observedMinutes = Math.max(
      1,
      Math.ceil((Math.min(dayEndsAt.getTime(), now.getTime()) - dayStartsAt.getTime()) / minuteMs),
    )

    return clampPercent((downMinutes / observedMinutes) * 100)
  }

  return 0
}

function inferCheckInterval(rows: StatusResult[]): number {
  const intervals: number[] = []

  for (let index = 1; index < rows.length; index += 1) {
    const interval = rows[index]!.createdAt.getTime() - rows[index - 1]!.createdAt.getTime()

    if (interval > 0) {
      intervals.push(interval)
    }
  }

  if (intervals.length === 0) {
    return defaultCheckIntervalMs
  }

  intervals.sort((a, b) => a - b)

  return intervals[Math.floor(intervals.length / 2)] ?? defaultCheckIntervalMs
}

function formatDayTooltip(dateLabel: string, status: DayStatus, downMinutes: number): string {
  if (status === 'down') {
    return `${dateLabel} - DOWN for ${downMinutes} ${downMinutes === 1 ? 'minute' : 'minutes'}`
  }

  if (status === 'up') {
    return `${dateLabel} - Status OK`
  }

  return `${dateLabel} - No checks`
}

function formatLongUtcDate(date: Date): string {
  const day = date.getUTCDate()

  return `${date.toLocaleDateString('en', {
    weekday: 'long',
    timeZone: 'UTC',
  })}, ${date.toLocaleDateString('en', {
    month: 'long',
    timeZone: 'UTC',
  })} ${day}${ordinalSuffix(day)}, ${date.getUTCFullYear()}`
}

function ordinalSuffix(day: number): string {
  const lastTwoDigits = day % 100

  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
    return 'th'
  }

  switch (day % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}
