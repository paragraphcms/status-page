const minuteMs = 60_000

type CronField = {
  values: Set<number>
}

type CronSchedule = {
  expression: string
  minutes: CronField
  hours: CronField
  daysOfMonth: CronField
  months: CronField
  daysOfWeek: CronField
}

export type LocalCronJob = {
  name: string
  expression: string
  run(now: Date): Promise<void>
}

type ScheduledLocalCronJob = LocalCronJob & {
  schedule: CronSchedule
  running: boolean
  lastRunMinuteKey?: string
}

export function startLocalCronScheduler(jobs: LocalCronJob[]): () => void {
  const scheduledJobs = jobs.map((job) => ({
    ...job,
    schedule: parseCronExpression(job.expression),
    running: false,
  }))
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = () => {
    const now = new Date()

    for (const job of scheduledJobs) {
      runIfDue(job, now)
    }

    scheduleNextTick()
  }

  const scheduleNextTick = () => {
    timer = setTimeout(tick, msUntilNextMinute())
  }

  scheduleNextTick()

  return () => {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

function runIfDue(job: ScheduledLocalCronJob, now: Date): void {
  if (!matchesCronSchedule(job.schedule, now)) {
    return
  }

  const minuteKey = utcMinuteKey(now)

  if (job.lastRunMinuteKey === minuteKey) {
    return
  }

  job.lastRunMinuteKey = minuteKey

  if (job.running) {
    console.warn(`[cron:${job.name}] skipped ${now.toISOString()} because the previous run is still active`)
    return
  }

  job.running = true
  console.log(`[cron:${job.name}] starting ${now.toISOString()} for "${job.expression}"`)

  void job.run(now)
    .then(() => {
      console.log(`[cron:${job.name}] completed`)
    })
    .catch((error) => {
      console.error(`[cron:${job.name}] failed: ${errorMessage(error)}`)
    })
    .finally(() => {
      job.running = false
    })
}

function parseCronExpression(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/)

  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression "${expression}". Expected 5 fields.`)
  }

  return {
    expression,
    minutes: parseCronField(fields[0], 0, 59, 'minute'),
    hours: parseCronField(fields[1], 0, 23, 'hour'),
    daysOfMonth: parseCronField(fields[2], 1, 31, 'day of month'),
    months: parseCronField(fields[3], 1, 12, 'month'),
    daysOfWeek: parseCronField(fields[4], 0, 7, 'day of week', (value) =>
      value === 7 ? 0 : value,
    ),
  }
}

function parseCronField(
  raw: string,
  min: number,
  max: number,
  fieldName: string,
  normalizeValue: (value: number) => number = (value) => value,
): CronField {
  const values = new Set<number>()

  for (const part of raw.split(',')) {
    addCronPartValues(values, part, min, max, fieldName, normalizeValue)
  }

  if (values.size === 0) {
    throw new Error(`Invalid ${fieldName} field "${raw}".`)
  }

  return { values }
}

function addCronPartValues(
  values: Set<number>,
  rawPart: string,
  min: number,
  max: number,
  fieldName: string,
  normalizeValue: (value: number) => number,
): void {
  const part = rawPart.trim()
  const stepParts = part.split('/')

  if (part.length === 0 || stepParts.length > 2) {
    throw new Error(`Invalid ${fieldName} cron field part "${rawPart}".`)
  }

  const step = stepParts[1] === undefined ? 1 : parseCronInteger(stepParts[1], fieldName)

  if (step < 1) {
    throw new Error(`Invalid ${fieldName} cron step "${stepParts[1]}".`)
  }

  const range = stepParts[0]
  const [start, end] = parseCronRange(range, min, max, fieldName)

  for (let value = start; value <= end; value += step) {
    values.add(normalizeValue(value))
  }
}

function parseCronRange(
  raw: string,
  min: number,
  max: number,
  fieldName: string,
): [number, number] {
  if (raw === '*') {
    return [min, max]
  }

  const rangeParts = raw.split('-')

  if (rangeParts.length === 1) {
    const value = parseCronInteger(rangeParts[0], fieldName)
    assertCronValue(value, min, max, fieldName)
    return [value, value]
  }

  if (rangeParts.length === 2) {
    const start = parseCronInteger(rangeParts[0], fieldName)
    const end = parseCronInteger(rangeParts[1], fieldName)
    assertCronValue(start, min, max, fieldName)
    assertCronValue(end, min, max, fieldName)

    if (start > end) {
      throw new Error(`Invalid ${fieldName} cron range "${raw}".`)
    }

    return [start, end]
  }

  throw new Error(`Invalid ${fieldName} cron range "${raw}".`)
}

function parseCronInteger(raw: string, fieldName: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid ${fieldName} cron value "${raw}".`)
  }

  return Number.parseInt(raw, 10)
}

function assertCronValue(
  value: number,
  min: number,
  max: number,
  fieldName: string,
): void {
  if (value < min || value > max) {
    throw new Error(`Invalid ${fieldName} cron value "${value}". Expected ${min}-${max}.`)
  }
}

function matchesCronSchedule(schedule: CronSchedule, date: Date): boolean {
  return (
    schedule.minutes.values.has(date.getUTCMinutes()) &&
    schedule.hours.values.has(date.getUTCHours()) &&
    schedule.daysOfMonth.values.has(date.getUTCDate()) &&
    schedule.months.values.has(date.getUTCMonth() + 1) &&
    schedule.daysOfWeek.values.has(date.getUTCDay())
  )
}

function utcMinuteKey(date: Date): string {
  return [
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
  ].join(':')
}

function msUntilNextMinute(): number {
  const now = Date.now()

  return minuteMs - (now % minuteMs) + 25
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
