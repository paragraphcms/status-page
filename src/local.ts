import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import { createApp } from "./app";
import type { AppEnv } from "./env";
import { schema } from "./db";
import { startLocalCronScheduler } from "./local-cron";
import { cleanupOldResults, runConfiguredChecks } from "./status/service";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const hostname = process.env.HOST ?? "0.0.0.0";
const databasePath = process.env.DATABASE_PATH ?? "./status.sqlite";
const checksCron = process.env.CHECKS_CRON ?? "*/5 * * * *";
const legacyAssetsPrefix = "/assets/";

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

startLocalCronScheduler([
  {
    name: "checks",
    expression: checksCron,
    run: async (now) => {
      const summary = await runConfiguredChecks(env, db, now);

      console.log(
        `[cron:checks] stored ${summary.results.length} result(s), status=${String(summary.status)}`,
      );
    },
  },
  {
    name: "cleanup",
    expression: env.CLEANUP_CRON ?? "0 3 * * *",
    run: async (now) => {
      const result = await cleanupOldResults(env, db, now);

      console.log(`[cron:cleanup] retained ${result.retentionDays} day(s) of history`);
    },
  },
]);

const server = Bun.serve({
  hostname,
  port,
  fetch: async (request) => {
    const assetResponse = await serveLocalAsset(request);

    if (assetResponse) {
      return assetResponse;
    }

    return app.fetch(request, env);
  },
});

console.log(
  `Status page local server listening on http://${server.hostname}:${server.port}`,
);
console.log(
  `Local cron scheduler enabled: checks="${checksCron}", cleanup="${env.CLEANUP_CRON ?? "0 3 * * *"}" (UTC)`,
);

async function serveLocalAsset(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  const relativePath = getLocalAssetPath(url.pathname);

  if (relativePath === undefined) {
    return undefined;
  }

  if (!relativePath || relativePath.includes("..") || relativePath.includes("\\")) {
    return new Response("Not found", { status: 404 });
  }

  const file = Bun.file(`assets/${relativePath}`);

  if (!(await file.exists())) {
    return undefined;
  }

  return new Response(file, {
    headers: {
      "cache-control": "public, max-age=3600",
      "content-type": file.type || "application/octet-stream",
    },
  });
}

function getLocalAssetPath(pathname: string): string | undefined {
  if (
    pathname === "/" ||
    pathname === "/healthz" ||
    pathname === "/api" ||
    pathname.startsWith("/api/")
  ) {
    return undefined;
  }

  if (pathname.startsWith(legacyAssetsPrefix)) {
    return pathname.slice(legacyAssetsPrefix.length);
  }

  return pathname.startsWith("/") ? pathname.slice(1) : undefined;
}
