import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import { createApp } from "./app";
import type { AppEnv } from "./env";
import { schema } from "./db";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const databasePath = process.env.DATABASE_PATH ?? "./status.sqlite";

mkdirSync(dirname(databasePath), { recursive: true });

const sqlite = new Database(databasePath, {
  create: true,
  readwrite: true,
});
sqlite.exec(await Bun.file("migrations/0000_status_results.sql").text());

const db = drizzle(sqlite, { schema });
const app = createApp({
  getDb: () => db,
});

const env: AppEnv = {
  STATUS_ENDPOINTS_JSON: process.env.STATUS_ENDPOINTS_JSON,
  LOGO_URL: process.env.LOGO_URL,
  FAVICON_URL: process.env.FAVICON_URL,
  META: process.env.META,
  RETENTION_DAYS: process.env.RETENTION_DAYS,
  MOCK_PREVIOUS_DAYS: process.env.MOCK_PREVIOUS_DAYS,
  DISPLAY_DAYS: process.env.DISPLAY_DAYS,
  PAGE_TITLE: process.env.PAGE_TITLE,
  FOOTER_TITLE: process.env.FOOTER_TITLE,
  CLEANUP_CRON: process.env.CLEANUP_CRON,
  SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL,
  SLACK_STATUS_CHECK_COUNT: process.env.SLACK_STATUS_CHECK_COUNT,
};

const server = Bun.serve({
  port,
  fetch: (request) => app.fetch(request, env),
});

console.log(
  `Status page local server listening on http://localhost:${server.port}`,
);
