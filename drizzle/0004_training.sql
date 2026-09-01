CREATE TABLE `model_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`format` text DEFAULT 'yolo' NOT NULL,
	`storage_key` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`source_job_id` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `training_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`project_id` integer,
	`base_asset_id` integer NOT NULL,
	`status` text NOT NULL,
	`trainer_session_id` text,
	`dataset_key` text,
	`epochs` integer DEFAULT 50 NOT NULL,
	`imgsz` integer DEFAULT 640 NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`metrics` text,
	`output_asset_id` integer,
	`error` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`base_asset_id`) REFERENCES `model_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `training_jobs_org` ON `training_jobs` (`organization_id`,`createdAt`);