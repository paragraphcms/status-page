export const dayMs = 24 * 60 * 60 * 1000
export const minuteMs = 60 * 1000

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}
