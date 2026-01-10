CREATE TABLE `user_shortcuts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`action` text NOT NULL,
	`key` text NOT NULL,
	`scope` text DEFAULT 'canvas' NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_shortcuts_user` ON `user_shortcuts` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_user_shortcuts_action` ON `user_shortcuts` (`user_id`,`action`);