CREATE TABLE `usage_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`backend_id` text NOT NULL,
	`kind` text NOT NULL,
	`units` integer DEFAULT 1 NOT NULL,
	`bytes_in` integer DEFAULT 0 NOT NULL,
	`bytes_out` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `usage_events_org_time` ON `usage_events` (`organization_id`,`createdAt`);