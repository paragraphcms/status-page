FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV PORT=3000
ENV DATABASE_PATH=/data/status.sqlite
ENV PAGE_TITLE="example.com Status Page"
ENV LOGO_URL=
ENV FAVICON_URL=
ENV META=[{\"name\":\"description\",\"value\":\"example.com\"},{\"name\":\"og:title\",\"value\":\"example.com\"},{\"name\":\"og:type\",\"value\":\"website\"},{\"name\":\"og:site_name\",\"value\":\"example.com\"}]
ENV STATUS_ENDPOINTS_JSON=[{\"name\":\"example.com\",\"type\":\"dns\",\"host\":\"example.com\",\"recordType\":\"A\"}]
ENV RETENTION_DAYS=90
ENV DISPLAY_DAYS=90
ENV FOOTER_TITLE="example.com Open Status Page"
ENV CHECKS_CRON="*/5 * * * *"
ENV SUMMARY_CRON="10 0 * * *"
ENV CLEANUP_CRON="0 3 * * *"
ENV SLACK_WEBHOOK_URL=
ENV SLACK_STATUS_CHECK_COUNT=3

RUN mkdir -p /data

EXPOSE 3000

CMD ["bun", "run", "start:local"]
