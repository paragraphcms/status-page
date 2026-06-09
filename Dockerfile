FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV PORT=3000
ENV DATABASE_PATH=/data/status.sqlite
ENV RETENTION_DAYS=90
ENV MOCK_PREVIOUS_DAYS=
ENV DISPLAY_DAYS=60
ENV FOOTER_TITLE="Paragraph CMS Open Status Page"
ENV SLACK_WEBHOOK_URL=
ENV SLACK_STATUS_CHECK_COUNT=3

RUN mkdir -p /data

EXPOSE 3000

CMD ["bun", "run", "start:local"]
