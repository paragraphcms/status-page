import { Hono } from 'hono'

import type { AppEnv, AppRuntime } from './env'
import { getFaviconUrl, getFooterTitle, getLogoUrl, getMeta, getPageTitle } from './env'
import {
  cleanupOldResults,
  getSlackStatusSummary,
  getStatusSnapshot,
  runConfiguredChecks,
  summarizeStatusHistory,
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
        meta: getMeta(env, c.req.url),
      }),
    )
  })

  app.get('/robots.txt', (c) => {
    const requestUrl = new URL(c.req.url)
    const sitemapUrl = new URL('/sitemap.xml', requestUrl).toString()

    return c.text(renderRobotsTxt(sitemapUrl), 200, {
      'cache-control': 'public, max-age=3600',
    })
  })

  app.get('/sitemap.xml', (c) => {
    const requestUrl = new URL(c.req.url)
    const homeUrl = new URL('/', requestUrl).toString()

    return c.body(renderSitemapXml(homeUrl), 200, {
      'cache-control': 'public, max-age=3600',
      'content-type': 'application/xml; charset=utf-8',
    })
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

  app.post('/api/summaries/run', async (c) => {
    const env = c.env
    const db = runtime.getDb(env)
    const result = await summarizeStatusHistory(env, db, runtime.now?.())

    return c.json({ status: true, ...result })
  })

  app.get('/api/summaries/run', async (c) => {
    const env = c.env
    const db = runtime.getDb(env)
    const result = await summarizeStatusHistory(env, db, runtime.now?.())

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

function renderRobotsTxt(sitemapUrl: string): string {
  return `User-agent: *
Allow: /

Sitemap: ${sitemapUrl}
`
}

function renderSitemapXml(homeUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${escapeXml(homeUrl)}</loc>
  </url>
</urlset>
`
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => {
    switch (character) {
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '&':
        return '&amp;'
      case "'":
        return '&apos;'
      case '"':
        return '&quot;'
      default:
        return character
    }
  })
}
