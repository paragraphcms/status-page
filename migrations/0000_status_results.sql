CREATE TABLE IF NOT EXISTS `status_results` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `status` integer NOT NULL,
  `created_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `status_results_name_created_at_idx`
ON `status_results` (`name`, `created_at`);
