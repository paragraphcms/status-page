import { drizzle } from 'drizzle-orm/d1'

import { createApp } from './app'
import type { AppEnv } from './env'
import { cleanupOldResults, runConfiguredChecks } from './status/service'
import { schema } from './db'

function getD1Db(env: AppEnv) {
  if (!env.DB) {
    throw new Error('Missing D1 binding DB.')
  }

  return drizzle(env.DB, { schema })
}

const app = createApp({
  getDb: getD1Db,
})

const worker: ExportedHandler<AppEnv> = {
  fetch: app.fetch,

  scheduled(controller, env, ctx) {
    const db = getD1Db(env)
    const job =
      controller.cron === (env.CLEANUP_CRON ?? '0 3 * * *')
        ? cleanupOldResults(env, db)
        : runConfiguredChecks(env, db)

    ctx.waitUntil(job)
  },
}

export default worker
