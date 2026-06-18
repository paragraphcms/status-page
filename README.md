# Status Page

Cloudflare Worker + Hono status page with scheduled checks and Drizzle history on D1.


<p align="center">
  <img src="./assets/paragraphcms-open-soruce-status-page.jpg" alt="@paragraphcms/status-page" />
</p>


## Configure

Set `STATUS_ENDPOINTS_JSON` to a JSON array:

```json
[
  {
    "name": "API health",
    "description": "Core backend API.",
    "private": false,
    "type": "http",
    "url": "https://api.example.com/health",
    "method": "GET",
    "headers": {
      "Authorization": "Bearer example-token",
      "Auth-Version": "2024-06-01"
    },
    "expectedStatus": [200],
    "timeoutMs": 10000,
    "softFail": true,
    "softFailMilliseconds": 500,
    "expectedBodyIncludes": "ok",
    "expectedBodyExcludes": "error",
    "expectedJson": { "status": "ok" }
  },
  {
    "name": "SSL cert",
    "type": "ssl",
    "host": "example.com",
    "port": 443,
    "warnBeforeDays": 14
  },
  {
    "name": "Postgres",
    "private": true,
    "type": "tcp",
    "host": "db.example.com",
    "port": 5432,
    "timeoutMs": 10000
  },
  {
    "name": "DNS example.com",
    "type": "dns",
    "host": "example.com",
    "recordType": "A"
  }
]
```

Endpoint can set `"private": true` to run checks in the background without showing that monitor on `/` or `/api/status`. The default is `false`.

HTTP endpoints can set `"softFail": true` to retry a failed check after `"softFailMilliseconds"` before recording it as down. The defaults are `false` and `500`.

HTTP endpoints can set `"headers"` to send custom request headers such as `Authorization` or `Auth-Version`.

Other env vars:

- `LOGO_URL` - logo shown in the top-left header.
- `FAVICON_URL` - favicon URL rendered as `<link rel="icon">`.
- `RETENTION_DAYS` - how many days to keep in storage, default `90`.
- `MOCK_PREVIOUS_DAYS` - optional success percentage for bootstrapping history over the previous `RETENTION_DAYS` days when there is no stored raw data or daily summaries yet, for example `99,9832423`.
- `DISPLAY_DAYS` - how many days to display on the status page and in `/api/status`, default `60`.
- `PAGE_TITLE` - page title and header label, default `Status Page`.
- `FOOTER_TITLE` - footer label, default `Paragraph CMS Open Status Page`.
- `META` - JSON array of `{ "name": string, "value": string }` entries. `og:*` entries render as `<meta property="...">`; all other entries render as `<meta name="...">`.
- `og:image` and `twitter:image` default to `/paragraphcms-open-soruce-status-page.jpg`, resolved against the current request origin.
- `SUMMARY_CRON` - cron expression used to roll up every previous UTC day into `status_daily_summaries`, default `10 0 * * *`.
- `CLEANUP_CRON` - cron expression used to identify the cleanup run, default `0 3 * * *`.
- `CHECKS_CRON` - local/Docker cron expression for status checks, default `*/5 * * * *`. Wrangler deploys use the cron trigger in `wrangler.jsonc`.
- `SLACK_WEBHOOK_URL` - incoming Slack webhook used by `GET /api/slack-status` when failures are detected.
- `SLACK_STATUS_CHECK_COUNT` - how many latest stored checks per configured monitor are inspected by `GET /api/slack-status`, default `3`.

`META` example:

```json
[
  {
    "name": "description",
    "value": "Live uptime, availability, and incident status for Paragraph CMS services."
  },
  {
    "name": "og:description",
    "value": "Live uptime, availability, and incident status for Paragraph CMS services."
  },
  {
    "name": "og:title",
    "value": "Paragraph CMS Status Page"
  },
  {
    "name": "og:type",
    "value": "website"
  },
  {
    "name": "og:site_name",
    "value": "Paragraph CMS Status"
  },
  {
    "name": "twitter:card",
    "value": "summary_large_image"
  },
  {
    "name": "twitter:title",
    "value": "Paragraph CMS Status Page"
  },
  {
    "name": "twitter:description",
    "value": "Live uptime, availability, and incident status for Paragraph CMS services."
  },
  {
    "name": "og:url",
    "value": "https://status.paragraphcms.com/"
  }
]
```

Override the default social preview image by adding explicit entries to `META`:

```json
[
  {
    "name": "og:image",
    "value": "https://paragraphcms.com/branding/paragraphcms-logo-color.svg"
  },
  {
    "name": "twitter:image",
    "value": "https://paragraphcms.com/branding/paragraphcms-logo-color.svg"
  }
]
```

## Cloudflare

1. Create D1 and paste its `database_id` into `wrangler.jsonc`.
2. Apply migrations:

```sh
bun run db:migrate:remote
```

3. Run locally with Wrangler:

```sh
bun run dev
```

4. If you use Slack notifications, store the webhook as a secret:

```sh
bunx wrangler secret put SLACK_WEBHOOK_URL
```

5. Deploy:

```sh
bunx wrangler deploy
```

The default cron setup runs checks every 5 minutes, summarizes previous days daily at 00:10 UTC, and runs cleanup daily at 03:00 UTC.

When an older deployment already has historical rows in `status_results` but no `status_daily_summaries` yet, the first page/API request or the next checks cron run will backfill those summaries automatically and delete the summarized raw rows. You do not need to call the summary endpoint manually after deploy.

## Local SQLite / Docker

```sh
bun run dev:local
```

Example local run with env vars:

```sh
PORT=3000 \
DATABASE_PATH=/tmp/status-page.sqlite \
PAGE_TITLE='Paragraph CMS Status Page' \
LOGO_URL='https://paragraphcms.com/paragraph-cms-logo.svg' \
FAVICON_URL='https://paragraphcms.com/favicon.ico' \
RETENTION_DAYS=90 \
MOCK_PREVIOUS_DAYS=99,9832423 \
DISPLAY_DAYS=60 \
FOOTER_TITLE='Paragraph CMS Open Status Page' \
SUMMARY_CRON='10 0 * * *' \
SLACK_STATUS_CHECK_COUNT=3 \
CHECKS_CRON='*/5 * * * *' \
SLACK_WEBHOOK_URL='https://hooks.slack.com/services/REPLACE/ME' \
STATUS_ENDPOINTS_JSON='[{"name":"DNS example.com","type":"dns","host":"example.com","recordType":"A"}]' \
bun run start:local
```

Docker uses Bun SQLite through the same Drizzle schema, runs the local cron scheduler, and serves bundled files from `assets/` at the site root to match Cloudflare Workers assets:

```sh
docker build -t status-page .
docker run -p 3000:3000 \
  -e STATUS_ENDPOINTS_JSON='[{"name":"DNS example.com","type":"dns","host":"example.com","recordType":"A"}]' \
  status-page
```

Manual endpoints:

- `GET /` - SSR status page.
- `GET /robots.txt` - generated robots policy with a `Sitemap` entry for the current origin.
- `GET /sitemap.xml` - generated sitemap for the status page homepage.
- `GET /api/status` - JSON status snapshot.
- `GET /api/checks/run` and `POST /api/checks/run` - run all checks and persist results.
- `GET /api/slack-status` - read the latest `SLACK_STATUS_CHECK_COUNT` stored results per monitor and notify Slack through `SLACK_WEBHOOK_URL` if any inspected result failed.
- `GET /api/summaries/run` and `POST /api/summaries/run` - summarize every UTC day before today into `status_daily_summaries` and delete the summarized raw rows.
- `POST /api/cleanup` - delete rows older than `RETENTION_DAYS`.

Local curl examples:

```sh
curl -sS -i http://localhost:3000/healthz
curl -sS -i http://localhost:3000/api/status
curl -sS -i -X POST http://localhost:3000/api/checks/run
curl -sS -i http://localhost:3000/api/checks/run
curl -sS -i http://localhost:3000/api/slack-status
curl -sS -i -X POST http://localhost:3000/api/summaries/run
curl -sS -i -X POST http://localhost:3000/api/cleanup
```
