type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

type BaseCheckConfig = {
  name: string
  description?: string
  private?: boolean
}

export type HttpCheckConfig = BaseCheckConfig & {
  type: 'http'
  url: string
  method: string
  headers?: Record<string, string>
  expectedStatus: number[]
  timeoutMs: number
  softFail: boolean
  softFailMilliseconds: number
  expectedBodyIncludes?: string
  expectedBodyExcludes?: string
  expectedJson?: JsonObject
}

export type SslCheckConfig = BaseCheckConfig & {
  type: 'ssl'
  host: string
  port: number
  warnBeforeDays: number
  timeoutMs: number
}

export type TcpCheckConfig = BaseCheckConfig & {
  type: 'tcp'
  host: string
  port: number
  timeoutMs: number
}

export type DnsCheckConfig = BaseCheckConfig & {
  type: 'dns'
  host: string
  recordType: string
  timeoutMs: number
}

export type StatusCheckConfig =
  | HttpCheckConfig
  | SslCheckConfig
  | TcpCheckConfig
  | DnsCheckConfig

export type ParsedStatusEndpoints = {
  configs: StatusCheckConfig[]
  errors: string[]
}

export function parseStatusEndpoints(raw: unknown): ParsedStatusEndpoints {
  const errors: string[] = []
  const parsed = parseRawJson(raw, errors)

  if (!Array.isArray(parsed)) {
    return {
      configs: [],
      errors: [
        ...errors,
        'STATUS_ENDPOINTS_JSON must be a JSON array.',
      ],
    }
  }

  const usedNames = new Set<string>()
  const configs: StatusCheckConfig[] = []

  parsed.forEach((value, index) => {
    const prefix = `STATUS_ENDPOINTS_JSON[${index}]`

    if (!isPlainObject(value)) {
      errors.push(`${prefix} must be an object.`)
      return
    }

    const name = readRequiredString(value, 'name', prefix, errors)
    const type = readRequiredString(value, 'type', prefix, errors)
    const description = readOptionalString(value, 'description', prefix, errors)
    const isPrivate = readOptionalBoolean(value, 'private', prefix, errors)

    if (!name || !type) {
      return
    }

    if (usedNames.has(name)) {
      errors.push(`${prefix}.name must be unique because history is stored by name.`)
      return
    }

    usedNames.add(name)

    const base = {
      name,
      ...(description ? { description } : {}),
      ...(isPrivate ? { private: true } : {}),
    }

    switch (type) {
      case 'http': {
        const url = readRequiredString(value, 'url', prefix, errors)
        if (!url || !isHttpUrl(url)) {
          errors.push(`${prefix}.url must be an http or https URL.`)
          return
        }

        configs.push({
          ...base,
          type,
          url,
          method: readOptionalString(value, 'method', prefix, errors) ?? 'GET',
          headers: readHttpHeaders(value, prefix, errors),
          expectedStatus: readExpectedStatuses(value, prefix, errors),
          timeoutMs: readPositiveInteger(value, 'timeoutMs', 10000, prefix, errors),
          softFail: readOptionalBoolean(value, 'softFail', prefix, errors),
          softFailMilliseconds: readNonNegativeInteger(
            value,
            'softFailMilliseconds',
            500,
            prefix,
            errors,
          ),
          expectedBodyIncludes: readOptionalString(
            value,
            'expectedBodyIncludes',
            prefix,
            errors,
          ),
          expectedBodyExcludes: readOptionalString(
            value,
            'expectedBodyExcludes',
            prefix,
            errors,
          ),
          expectedJson: readExpectedJson(value, prefix, errors),
        })
        return
      }

      case 'ssl': {
        const host = readRequiredString(value, 'host', prefix, errors)
        if (!host) {
          return
        }

        configs.push({
          ...base,
          type,
          host,
          port: readPort(value, 443, prefix, errors),
          warnBeforeDays: readPositiveInteger(
            value,
            'warnBeforeDays',
            14,
            prefix,
            errors,
          ),
          timeoutMs: readPositiveInteger(value, 'timeoutMs', 10000, prefix, errors),
        })
        return
      }

      case 'tcp': {
        const host = readRequiredString(value, 'host', prefix, errors)
        if (!host) {
          return
        }

        configs.push({
          ...base,
          type,
          host,
          port: readPort(value, undefined, prefix, errors),
          timeoutMs: readPositiveInteger(value, 'timeoutMs', 10000, prefix, errors),
        })
        return
      }

      case 'dns': {
        const host = readRequiredString(value, 'host', prefix, errors)
        if (!host) {
          return
        }

        const recordType =
          readOptionalString(value, 'recordType', prefix, errors)?.toUpperCase() ??
          'A'

        if (!/^[A-Z0-9]+$/.test(recordType)) {
          errors.push(`${prefix}.recordType must be a DNS record type, for example A.`)
          return
        }

        configs.push({
          ...base,
          type,
          host,
          recordType,
          timeoutMs: readPositiveInteger(value, 'timeoutMs', 10000, prefix, errors),
        })
        return
      }

      default:
        errors.push(`${prefix}.type must be one of: http, ssl, tcp, dns.`)
    }
  })

  return { configs, errors }
}

function parseRawJson(raw: unknown, errors: string[]): unknown {
  if (raw === undefined || raw === null || raw === '') {
    return []
  }

  if (typeof raw !== 'string') {
    return raw
  }

  try {
    return JSON.parse(raw)
  } catch (error) {
    errors.push(
      `STATUS_ENDPOINTS_JSON is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return []
  }
}

function readRequiredString(
  object: Record<string, unknown>,
  key: string,
  prefix: string,
  errors: string[],
): string | undefined {
  const value = object[key]

  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${prefix}.${key} must be a non-empty string.`)
    return undefined
  }

  return value.trim()
}

function readOptionalString(
  object: Record<string, unknown>,
  key: string,
  prefix: string,
  errors: string[],
): string | undefined {
  const value = object[key]

  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (typeof value !== 'string') {
    errors.push(`${prefix}.${key} must be a string when provided.`)
    return undefined
  }

  return value.trim()
}

function readOptionalBoolean(
  object: Record<string, unknown>,
  key: string,
  prefix: string,
  errors: string[],
): boolean {
  const value = object[key]

  if (value === undefined || value === null) {
    return false
  }

  if (typeof value !== 'boolean') {
    errors.push(`${prefix}.${key} must be a boolean when provided.`)
    return false
  }

  return value
}

function readExpectedStatuses(
  object: Record<string, unknown>,
  prefix: string,
  errors: string[],
): number[] {
  const value = object.expectedStatus

  if (value === undefined) {
    return [200]
  }

  const values = Array.isArray(value) ? value : [value]
  const statuses = values.filter(isInteger).map(Number)

  if (statuses.length !== values.length || statuses.some((status) => status < 100 || status > 599)) {
    errors.push(`${prefix}.expectedStatus must be an array of HTTP status codes.`)
    return [200]
  }

  return statuses
}

function readHttpHeaders(
  object: Record<string, unknown>,
  prefix: string,
  errors: string[],
): Record<string, string> | undefined {
  const value = object.headers

  if (value === undefined) {
    return undefined
  }

  if (!isPlainObject(value)) {
    errors.push(`${prefix}.headers must be an object of HTTP header name/value pairs.`)
    return undefined
  }

  const headers: Record<string, string> = {}

  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = rawName.trim()

    if (!isValidHttpHeaderName(name)) {
      errors.push(`${prefix}.headers contains an invalid header name "${rawName}".`)
      continue
    }

    if (
      typeof rawValue !== 'string' &&
      typeof rawValue !== 'number' &&
      typeof rawValue !== 'boolean'
    ) {
      errors.push(
        `${prefix}.headers.${name} must be a string, number, or boolean.`,
      )
      continue
    }

    headers[name] = String(rawValue)
  }

  return headers
}

function readExpectedJson(
  object: Record<string, unknown>,
  prefix: string,
  errors: string[],
): JsonObject | undefined {
  const value = object.expectedJson

  if (value === undefined) {
    return undefined
  }

  if (!isPlainObject(value)) {
    errors.push(`${prefix}.expectedJson must be a JSON object when provided.`)
    return undefined
  }

  return value as JsonObject
}

function readPort(
  object: Record<string, unknown>,
  fallback: number | undefined,
  prefix: string,
  errors: string[],
): number {
  const value = object.port

  if (value === undefined && fallback !== undefined) {
    return fallback
  }

  if (!isInteger(value) || Number(value) < 1 || Number(value) > 65535) {
    errors.push(`${prefix}.port must be an integer between 1 and 65535.`)
    return fallback ?? 1
  }

  return Number(value)
}

function readPositiveInteger(
  object: Record<string, unknown>,
  key: string,
  fallback: number,
  prefix: string,
  errors: string[],
): number {
  const value = object[key]

  if (value === undefined) {
    return fallback
  }

  if (!isInteger(value) || Number(value) < 1) {
    errors.push(`${prefix}.${key} must be a positive integer.`)
    return fallback
  }

  return Number(value)
}

function readNonNegativeInteger(
  object: Record<string, unknown>,
  key: string,
  fallback: number,
  prefix: string,
  errors: string[],
): number {
  const value = object[key]

  if (value === undefined) {
    return fallback
  }

  if (!isInteger(value) || Number(value) < 0) {
    errors.push(`${prefix}.${key} must be a non-negative integer.`)
    return fallback
  }

  return Number(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value)
}

function isValidHttpHeaderName(value: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
