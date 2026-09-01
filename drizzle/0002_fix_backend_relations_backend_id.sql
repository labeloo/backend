/*
 Realigns `backend_relations` with src/db/schema.ts.

 Migration 0001 created this table with `backend_type_id integer` referencing a
 `backend_type` table. The code was later changed to store the backend type as a
 string id (`backend_id`, e.g. "openai" / "sam2") resolved against the static
 catalogue in src/config/backendTypes.json, but no migration was written for it -
 so `GET /api/backendRelations` failed with "no such column: backend_id" on every
 database built from these migrations, which is what broke configuring a SAM 2
 connection from the UI.
*/
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
INSERT INTO `__new_backend_relations` ("id", "organization_id", "backend_id", "base_url", "api_key", "is_active", "createdAt", "updatedAt")
SELECT
	"id",
	"organization_id",
	COALESCE((SELECT lower("backend_type"."name") FROM "backend_type" WHERE "backend_type"."id" = "backend_relations"."backend_type_id"), ''),
	"base_url",
	"api_key",
	"is_active",
	"createdAt",
	"updatedAt"
FROM `backend_relations`;
--> statement-breakpoint
DROP TABLE `backend_relations`;--> statement-breakpoint
ALTER TABLE `__new_backend_relations` RENAME TO `backend_relations`;--> statement-breakpoint
DROP TABLE `backend_type`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
