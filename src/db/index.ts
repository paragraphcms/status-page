import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'

import * as schema from './schema'

export type StatusDb = BaseSQLiteDatabase<'sync' | 'async', unknown, typeof schema>

export { schema }
