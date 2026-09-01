CREATE TABLE `org_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`billing_provider` text DEFAULT 'none' NOT NULL,
	`external_customer_id` text,
	`external_subscription_id` text,
	`current_period_start` integer,
	`current_period_end` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_subscriptions_organization_id_unique` ON `org_subscriptions` (`organization_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `is_platform_admin` integer DEFAULT false NOT NULL;