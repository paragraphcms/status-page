import type { MonitorSnapshot, StatusSnapshot } from "../status/snapshot";

export type StatusPageOptions = {
  title: string;
  footerTitle: string;
  logoUrl?: string;
  faviconUrl?: string;
  meta: StatusPageMeta[];
};

export type StatusPageMeta = {
  name: string;
  value: string;
};

export function renderStatusPage(
  snapshot: StatusSnapshot,
  options: StatusPageOptions,
): string {
  const headline = snapshot.operational
    ? "All systems are Operational"
    : snapshot.hasConfig && snapshot.hasData
      ? "Some systems are degraded"
      : snapshot.hasConfig
        ? "Waiting for first checks"
        : "No monitors configured";

  const pageStatusClass = snapshot.operational ? "status-up" : "status-down";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(options.title)}</title>
    ${renderFavicon(options)}
    ${renderMeta(options.meta)}
    <style>
      :root {
        color-scheme: light;
        --bg: #fdfdfd;
        --text: #111827;
        --muted: #6b7280;
        --line: #e5e7eb;
        --panel: #f9fafb;
        --up: #3dc662;
        --up-soft: rgba(61, 198, 98, 0.18);
        --down: #dc2627;
        --down-soft: rgba(220, 38, 39, 0.16);
        --empty: #e5e7eb;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background: var(--bg);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
      }

      .page {
        min-height: 100vh;
        padding: 24px;
      }

      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 20px;
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        color: var(--text);
        font-size: 14px;
        font-weight: 650;
        text-decoration: none;
      }

      .brand-mark,
      .brand img {
        width: 28px;
        height: 28px;
        border-radius: 6px;
      }

      .brand-mark {
        display: inline-grid;
        place-items: center;
        border: 1px solid var(--line);
        background: var(--panel);
        color: var(--muted);
        font-size: 11px;
      }

      main {
        width: min(655px, 100%);
        margin: 64px auto 0;
      }

      .headline {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 80px;
        font-size: clamp(12px, 1.8vw, 40px);
        font-weight: 550;
        line-height: 1.15;
        letter-spacing: 0;
      }

      .status-dot {
        position: relative;
        width: 7px;
        height: 7px;
        flex: 0 0 7px;
        border-radius: 999px;
      }

      .status-dot::after {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: currentColor;
        content: "";
        opacity: 0.42;
        transform-origin: center;
        animation: status-pulse 1.6s ease-out infinite;
      }

      .status-up .status-dot {
        background: var(--up);
        color: var(--up);
      }

      .status-down .status-dot {
        background: var(--down);
        color: var(--down);
      }

      @keyframes status-pulse {
        0% {
          opacity: 0.42;
          transform: scale(1);
        }

        70%,
        100% {
          opacity: 0;
          transform: scale(3);
        }
      }

      .monitors {
        display: grid;
        gap: 26px;
      }

      .monitor {
        position: relative;
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 8px;
        width: 100%;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--line);
      }

      .monitor-header,
      .monitor-body {
        grid-column: span 12;
      }

      .monitor-title-row,
      .monitor-meta {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }

      .monitor-name {
        margin: 0;
        overflow: hidden;
        color: var(--text);
        font-size: 20px;
        font-weight: 550;
        line-height: 1.25;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .monitor-description {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 12px;
        font-weight: 500;
        line-height: 1.45;
      }

      .monitor-kind {
        flex: 0 0 auto;
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 4px 7px;
        color: var(--muted);
        font-size: 11px;
        font-weight: 650;
        line-height: 1;
        text-transform: uppercase;
      }

      .monitor-body {
        min-height: 94px;
        padding-top: 8px;
      }

      .range-pill {
        display: inline-flex;
        align-items: center;
        height: 24px;
        border-radius: 6px;
        background: var(--panel);
        padding: 0 8px;
        color: var(--text);
        font-size: 12px;
        font-weight: 650;
      }

      .status-line {
        display: flex;
        gap: 10px;
        padding-top: 4px;
        text-align: right;
        font-size: 12px;
        font-weight: 700;
      }

      .uptime {
        border-right: 1px solid var(--line);
        padding-right: 10px;
      }

      .state-up {
        color: var(--up);
      }

      .state-down {
        color: var(--down);
      }

      .state-empty {
        color: var(--muted);
      }

      .daygrid {
        display: grid;
        grid-template-columns: repeat(var(--days), minmax(5px, 1fr));
        gap: 2px;
        min-height: 60px;
        margin-top: 4px;
        overflow-x: auto;
        overflow-y: hidden;
        padding: 4px 0;
      }

      .day {
        position: relative;
        min-width: 5px;
        height: 34px;
        border: 0;
        background: transparent;
        cursor: default;
        padding: 0 0 4px;
      }

      .day:focus-visible {
        outline: 2px solid var(--text);
        outline-offset: 3px;
      }

      .day span {
        display: block;
        width: 70%;
        min-width: 4px;
        height: 30px;
        margin: 0 auto;
        border-radius: 3px;
        background: var(--empty);
      }

      .day-up span {
        background: var(--up);
      }

      .day-down span {
        background: linear-gradient(
          to top,
          var(--down) 0 var(--down-height, 30px),
          var(--up) var(--down-height, 30px) 100%
        );
      }

      .status-tooltip {
        position: fixed;
        z-index: 20;
        width: max-content;
        max-width: min(320px, 80vw);
        border-radius: 6px;
        background: var(--text);
        color: #ffffff;
        font-size: 11px;
        font-weight: 650;
        line-height: 1.2;
        opacity: 0;
        padding: 7px 9px;
        pointer-events: none;
        transition: opacity 120ms ease;
        white-space: nowrap;
      }

      .status-tooltip.is-visible {
        opacity: 1;
      }

      .config-errors {
        margin-bottom: 24px;
        border: 1px solid var(--down-soft);
        border-radius: 8px;
        background: #fff7f7;
        padding: 12px 14px;
        color: #7f1d1d;
        font-size: 13px;
        line-height: 1.45;
      }

      .footer {
        margin: 28px 0 0;
        color: var(--muted);
        font-size: 12px;
        text-align: center;
      }

      @media (max-width: 700px) {
        .page {
          padding: 18px;
        }

        main {
          margin-top: 42px;
        }

        .headline {
          margin-bottom: 40px;
        }

        .monitor-name {
          white-space: normal;
        }

        .monitor-title-row,
        .monitor-meta {
          align-items: flex-start;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <header class="topbar">
        <a class="brand" href="/">
          ${renderLogo(options)}
          <span>${escapeHtml(options.title)}</span>
        </a>
      </header>
      <main>
        <h1 class="headline ${pageStatusClass}">
          <span class="status-dot" aria-hidden="true"></span>
          <span>${escapeHtml(headline)}</span>
        </h1>
        ${renderConfigErrors(snapshot.configErrors)}
        <section class="monitors" aria-label="Monitors">
          ${snapshot.monitors.map((monitor) => renderMonitor(monitor, snapshot.displayDays)).join("")}
        </section>
        <p class="footer">${escapeHtml(options.footerTitle)} &middot; Last updated ${escapeHtml(formatDateTime(snapshot.generatedAt))}</p>
      </main>
    </div>
    <script>
      (() => {
        const tooltip = document.createElement("div");
        tooltip.className = "status-tooltip";
        tooltip.setAttribute("role", "tooltip");
        document.body.append(tooltip);

        let activeDay = null;

        const hideTooltip = () => {
          activeDay = null;
          tooltip.classList.remove("is-visible");
        };

        const positionTooltip = (day) => {
          const text = day.dataset.tooltip;

          if (!text) {
            hideTooltip();
            return;
          }

          activeDay = day;
          tooltip.textContent = text;
          tooltip.classList.add("is-visible");

          const dayRect = day.getBoundingClientRect();
          const tooltipRect = tooltip.getBoundingClientRect();
          const edgeGap = 8;
          const preferredTop = dayRect.top - tooltipRect.height - edgeGap;
          const top =
            preferredTop >= edgeGap
              ? preferredTop
              : dayRect.bottom + edgeGap;
          const centeredLeft = dayRect.left + dayRect.width / 2 - tooltipRect.width / 2;
          const left = Math.min(
            window.innerWidth - tooltipRect.width - edgeGap,
            Math.max(edgeGap, centeredLeft),
          );

          tooltip.style.left = left + "px";
          tooltip.style.top = top + "px";
        };

        document.addEventListener("pointerover", (event) => {
          if (!(event.target instanceof Element)) {
            return;
          }

          const day = event.target.closest(".day");

          if (day instanceof HTMLElement) {
            positionTooltip(day);
          }
        });

        document.addEventListener("pointerout", (event) => {
          if (
            activeDay instanceof HTMLElement &&
            event.target instanceof Node &&
            activeDay.contains(event.target) &&
            (!(event.relatedTarget instanceof Node) || !activeDay.contains(event.relatedTarget))
          ) {
            hideTooltip();
          }
        });

        document.addEventListener("focusin", (event) => {
          if (event.target instanceof HTMLElement && event.target.classList.contains("day")) {
            positionTooltip(event.target);
          }
        });

        document.addEventListener("focusout", (event) => {
          if (event.target === activeDay) {
            hideTooltip();
          }
        });

        window.addEventListener("scroll", () => {
          if (activeDay instanceof HTMLElement) {
            positionTooltip(activeDay);
          }
        }, true);

        window.addEventListener("resize", () => {
          if (activeDay instanceof HTMLElement) {
            positionTooltip(activeDay);
          }
        });
      })();
    </script>
  </body>
</html>`;
}

function renderLogo(options: StatusPageOptions): string {
  if (options.logoUrl) {
    return `<img src="${escapeAttribute(options.logoUrl)}" alt="${escapeAttribute(options.title)} logo" style="max-height: 20px; width: auto;">`;
  }

  return '<span class="brand-mark" aria-hidden="true">SP</span>';
}

function renderFavicon(options: StatusPageOptions): string {
  if (!options.faviconUrl) {
    return "";
  }

  return `<link rel="icon" href="${escapeAttribute(options.faviconUrl)}">`;
}

function renderMeta(meta: StatusPageMeta[]): string {
  return meta.map(renderMetaTag).join("\n    ");
}

function renderMetaTag(entry: StatusPageMeta): string {
  const attributeName = entry.name.startsWith("og:") ? "property" : "name";

  return `<meta ${attributeName}="${escapeAttribute(entry.name)}" content="${escapeAttribute(entry.value)}">`;
}

function renderConfigErrors(errors: string[]): string {
  if (errors.length === 0) {
    return "";
  }

  return `<div class="config-errors">${errors.map((error) => `<div>${escapeHtml(error)}</div>`).join("")}</div>`;
}

function renderMonitor(monitor: MonitorSnapshot, displayDays: number): string {
  const stateClass =
    monitor.latestStatus === true
      ? "state-up"
      : monitor.latestStatus === false
        ? "state-down"
        : "state-empty";
  const stateText =
    monitor.latestStatus === true
      ? "Status OK"
      : monitor.latestStatus === false
        ? "Status Down"
        : "Pending";
  const uptime =
    monitor.uptimePercent === null
      ? "N/A"
      : `${monitor.uptimePercent.toFixed(4)}%`;

  return `<article class="monitor">
    <div class="monitor-header">
      <div class="monitor-title-row">
        <div>
          <h2 class="monitor-name">${escapeHtml(monitor.name)}</h2>
          ${monitor.description ? `<p class="monitor-description">${escapeHtml(monitor.description)}</p>` : ""}
        </div>
        <span class="monitor-kind">${escapeHtml(monitor.type)}</span>
      </div>
    </div>
    <div class="monitor-body">
      <div class="monitor-meta">
        <span class="range-pill">${displayDays} Days</span>
        <div class="status-line">
          <span class="uptime">${escapeHtml(uptime)}</span>
          <span class="${stateClass}">${escapeHtml(stateText)}</span>
        </div>
      </div>
      <div class="daygrid" style="--days: ${displayDays}">
        ${monitor.days.map((day) => renderDayButton(monitor, day)).join("")}
      </div>
    </div>
  </article>`;
}

function renderDayButton(
  monitor: MonitorSnapshot,
  day: MonitorSnapshot["days"][number],
): string {
  const style =
    day.status === "down"
      ? ` style="--down-height: ${formatDownHeight(day)}px"`
      : "";
  const tooltip = day.tooltip;

  return `<button class="day day-${day.status}"${style} data-tooltip="${escapeAttribute(tooltip)}" aria-label="${escapeAttribute(`${monitor.name} ${tooltip}`)}"><span></span></button>`;
}

function formatDownHeight(day: MonitorSnapshot["days"][number]): number {
  const fullHeight = 30;
  const minVisibleHeight = 4;
  const hasHealthyChecks = day.totalChecks > day.downChecks;
  const maxHeight = hasHealthyChecks
    ? fullHeight - minVisibleHeight
    : fullHeight;

  return Math.min(
    maxHeight,
    Math.max(
      minVisibleHeight,
      Math.round((fullHeight * day.downPercent) / 100),
    ),
  );
}

function formatDateTime(date: Date): string {
  return date.toLocaleString("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
