CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`annotation_id` integer NOT NULL,
	`task_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`reviewer_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`message` text,
	`is_auto_approved` integer DEFAULT false NOT NULL,
	`review_round` integer DEFAULT 1 NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`annotation_id`) REFERENCES `annotations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_reviews_annotation` ON `reviews` (`annotation_id`);--> statement-breakpoint
CREATE INDEX `idx_reviews_task` ON `reviews` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_reviews_project` ON `reviews` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_reviews_reviewer` ON `reviews` (`reviewer_id`);--> statement-breakpoint
CREATE INDEX `idx_reviews_status` ON `reviews` (`status`);--> statement-breakpoint
DROP TABLE `backend_type`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_backend_relations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`backend_id` text NOT NULL,
	`base_url` text NOT NULL,
	`api_key` text NOT NULL,
	`is_active` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_backend_relations`("id", "organization_id", "backend_id", "base_url", "api_key", "is_active", "createdAt", "updatedAt") SELECT "id", "organization_id", "backend_type_id" AS "backend_id", "base_url", "api_key", "is_active", "createdAt", "updatedAt" FROM `backend_relations`;--> statement-breakpoint
DROP TABLE `backend_relations`;--> statement-breakpoint
ALTER TABLE `__new_backend_relations` RENAME TO `backend_relations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `projects` ADD `review_mode` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `allow_self_review` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `auto_assign_reviewer` integer DEFAULT true NOT NULL;