import net from 'node:net'
import { connect as tlsConnect } from 'node:tls'

import type {
  DnsCheckConfig,
  HttpCheckConfig,
  JsonObject,
  JsonValue,
  SslCheckConfig,
  StatusCheckConfig,
  TcpCheckConfig,
} from './config'

const dayMs = 24 * 60 * 60 * 1000

export type CheckOutcome = {
  name: string
  type: StatusCheckConfig['type']
  description?: string
  status: boolean
  message: string
  latencyMs: number
  checkedAt: Date
}

export async function runStatusCheck(
  config: StatusCheckConfig,
  now = new Date(),
): Promise<CheckOutcome> {
  const startedAt = performance.now()

  try {
    switch (config.type) {
      case 'http':
        return await checkHttp(config, now, startedAt)
      case 'ssl':
        return await checkSsl(config, now, startedAt)
      case 'tcp':
        return await checkTcp(config, now, startedAt)
      case 'dns':
        return await checkDns(config, now, startedAt)
    }
  } catch (error) {
    return finish(config, now, startedAt, false, errorMessage(error))
  }
}

async function checkHttp(
  config: HttpCheckConfig,
  now: Date,
  startedAt: number,
): Promise<CheckOutcome> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

  try {
    const response = await fetch(config.url, {
      method: config.method,
      signal: controller.signal,
      redirect: 'follow',
    })

    const statusOk = config.expectedStatus.includes(response.status)
    let bodyOk = true
    const bodyMessages: string[] = []

    if (config.expectedBodyIncludes !== undefined || config.expectedJson !== undefined) {
      const text = await response.text()

      if (
        config.expectedBodyIncludes !== undefined &&
        !text.includes(config.expectedBodyIncludes)
      ) {
        bodyOk = false
        bodyMessages.push(`body does not include "${config.expectedBodyIncludes}"`)
      }

      if (config.expectedJson !== undefined) {
        try {
          const json = JSON.parse(text) as JsonValue
          if (!matchesExpectedJson(json, config.expectedJson)) {
            bodyOk = false
            bodyMessages.push('JSON body does not match expectedJson')
          }
        } catch {
          bodyOk = false
          bodyMessages.push('body is not valid JSON')
        }
      }
    }

    const status = statusOk && bodyOk
    const message = status
      ? `HTTP ${response.status}`
      : [
          statusOk
            ? undefined
            : `HTTP ${response.status}, expected ${config.expectedStatus.join(', ')}`,
          ...bodyMessages,
        ]
          .filter(Boolean)
          .join('; ')

    return finish(config, now, startedAt, status, message)
  } finally {
    clearTimeout(timeout)
  }
}

async function checkSsl(
  config: SslCheckConfig,
  now: Date,
  startedAt: number,
): Promise<CheckOutcome> {
  return await new Promise((resolve) => {
    let settled = false
    const timeout = setTimeout(() => {
      socket.destroy()
      resolveOnce(false, `TLS timed out after ${config.timeoutMs}ms`)
    }, config.timeoutMs)

    const resolveOnce = (status: boolean, message: string) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      socket.destroy()
      resolve(finish(config, now, startedAt, status, message))
    }

    const socket = tlsConnect({
      host: config.host,
      port: config.port,
      servername: config.host,
      rejectUnauthorized: true,
    })

    socket.once('secureConnect', () => {
      const certificate = socket.getPeerCertificate()
      const validTo = certificate.valid_to ? new Date(certificate.valid_to) : undefined
      const expiresInDays =
        validTo === undefined ? Number.NaN : Math.floor((validTo.getTime() - now.getTime()) / dayMs)

      if (!socket.authorized) {
        resolveOnce(false, `TLS unauthorized: ${String(socket.authorizationError)}`)
        return
      }

      if (!validTo || Number.isNaN(expiresInDays)) {
        resolveOnce(false, 'TLS certificate expiry date is unavailable')
        return
      }

      if (expiresInDays < config.warnBeforeDays) {
        resolveOnce(
          false,
          `TLS certificate expires in ${expiresInDays} days, threshold is ${config.warnBeforeDays}`,
        )
        return
      }

      resolveOnce(true, `TLS certificate expires in ${expiresInDays} days`)
    })

    socket.once('error', (error) => {
      resolveOnce(false, errorMessage(error))
    })
  })
}

async function checkTcp(
  config: TcpCheckConfig,
  now: Date,
  startedAt: number,
): Promise<CheckOutcome> {
  return await new Promise((resolve) => {
    let settled = false
    const socket = new net.Socket()
    const timeout = setTimeout(() => {
      socket.destroy()
      resolveOnce(false, `TCP timed out after ${config.timeoutMs}ms`)
    }, config.timeoutMs)

    const resolveOnce = (status: boolean, message: string) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      socket.destroy()
      resolve(finish(config, now, startedAt, status, message))
    }

    socket.once('connect', () => {
      resolveOnce(true, 'TCP connection opened')
    })

    socket.once('error', (error) => {
      resolveOnce(false, errorMessage(error))
    })

    socket.connect(config.port, config.host)
  })
}

async function checkDns(
  config: DnsCheckConfig,
  now: Date,
  startedAt: number,
): Promise<CheckOutcome> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

  try {
    const url = new URL('https://cloudflare-dns.com/dns-query')
    url.searchParams.set('name', config.host)
    url.searchParams.set('type', config.recordType)

    const response = await fetch(url, {
      headers: { accept: 'application/dns-json' },
      signal: controller.signal,
    })

    if (!response.ok) {
      return finish(config, now, startedAt, false, `DNS query returned HTTP ${response.status}`)
    }

    const payload = (await response.json()) as {
      Status?: number
      Answer?: unknown[]
    }

    if (payload.Status !== 0) {
      return finish(config, now, startedAt, false, `DNS response status ${String(payload.Status)}`)
    }

    const answerCount = Array.isArray(payload.Answer) ? payload.Answer.length : 0

    return finish(
      config,
      now,
      startedAt,
      answerCount > 0,
      answerCount > 0
        ? `DNS ${config.recordType} returned ${answerCount} answer(s)`
        : `DNS ${config.recordType} returned no answers`,
    )
  } finally {
    clearTimeout(timeout)
  }
}

function finish(
  config: StatusCheckConfig,
  checkedAt: Date,
  startedAt: number,
  status: boolean,
  message: string,
): CheckOutcome {
  return {
    name: config.name,
    type: config.type,
    description: config.description,
    status,
    message,
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    checkedAt,
  }
}

function matchesExpectedJson(actual: JsonValue, expected: JsonObject): boolean {
  if (!isJsonObject(actual)) {
    return false
  }

  return Object.entries(expected).every(([key, expectedValue]) => {
    if (!(key in actual)) {
      return false
    }

    return jsonValueMatches(actual[key], expectedValue)
  })
}

function jsonValueMatches(actual: JsonValue, expected: JsonValue): boolean {
  if (isJsonObject(expected)) {
    if (!isJsonObject(actual)) {
      return false
    }

    return Object.entries(expected).every(([key, expectedValue]) =>
      jsonValueMatches(actual[key], expectedValue),
    )
  }

  if (Array.isArray(expected)) {
    return JSON.stringify(actual) === JSON.stringify(expected)
  }

  return Object.is(actual, expected)
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.name === 'AbortError' ? 'Timed out' : error.message
  }

  return String(error)
}
