import { Hono } from 'hono'

import type { AppEnv, AppRuntime } from './env'
import { getFaviconUrl, getFooterTitle, getLogoUrl, getMeta, getPageTitle } from './env'
import {
  cleanupOldResults,
  getSlackStatusSummary,
  getStatusSnapshot,
  runConfiguredChecks,
} from './status/service'
import { renderStatusPage } from './ui/render'

export function createApp(runtime: AppRuntime): Hono<{ Bindings: AppEnv }> {
  const app = new Hono<{ Bindings: AppEnv }>()

  app.get('/', async (c) => {
    const env = c.env
    const db = runtime.getDb(env)
    const snapshot = await getStatusSnapshot(env, db, runtime.now?.())

    return c.html(
      renderStatusPage(snapshot, {
        title: getPageTitle(env),
        footerTitle: getFooterTitle(env),
        logoUrl: getLogoUrl(env),
        faviconUrl: getFaviconUrl(env),
        meta: getMeta(env),
      }),
    )
  })

  app.get('/healthz', (c) => c.json({ status: true }))

  app.get('/api/status', async (c) => {
    const env = c.env
    const db = runtime.getDb(env)
    const snapshot = await getStatusSnapshot(env, db, runtime.now?.())

    return c.json(snapshot)
  })

  app.post('/api/checks/run', async (c) => {
    const env = c.env
    const db = runtime.getDb(env)
    const summary = await runConfiguredChecks(env, db, runtime.now?.())

    return c.json(summary, summary.status ? 200 : 503)
  })

  app.get('/api/checks/run', async (c) => {
    const env = c.env
    const db = runtime.getDb(env)
    const summary = await runConfiguredChecks(env, db, runtime.now?.())

    return c.json(summary, summary.status ? 200 : 503)
  })

  app.get('/api/slack-status', async (c) => {
    const env = c.env
    const db = runtime.getDb(env)
    const summary = await getSlackStatusSummary(env, db, runtime.now?.())

    return c.json(summary, summary.status ? 200 : 503)
  })

  app.post('/api/cleanup', async (c) => {
    const env = c.env
    const db = runtime.getDb(env)
    const result = await cleanupOldResults(env, db, runtime.now?.())

    return c.json({ status: true, ...result })
  })

  app.notFound((c) => c.json({ status: false, message: 'Not found' }, 404))

  app.onError((error, c) => {
    return c.json(
      {
        status: false,
        message: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  })

  return app
}
