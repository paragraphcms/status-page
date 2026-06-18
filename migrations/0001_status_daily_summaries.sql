CREATE TABLE IF NOT EXISTS `status_daily_summaries` (
  `name` text NOT NULL,
  `day_start_at` integer NOT NULL,
  `total_checks` integer NOT NULL,
  `down_checks` integer NOT NULL,
  `down_minutes` integer NOT NULL,
  `latest_status` integer NOT NULL,
  `latest_checked_at` integer NOT NULL,
  PRIMARY KEY (`name`, `day_start_at`)
);

CREATE INDEX IF NOT EXISTS `status_daily_summaries_day_start_at_idx`
ON `status_daily_summaries` (`day_start_at`);
