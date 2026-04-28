CREATE TABLE `domains` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '#718096' NOT NULL,
	`icon` text DEFAULT '📂' NOT NULL,
	`parent_slug` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `entity_domains` (
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`domain_slug` text NOT NULL,
	`auto_tagged` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY (`entity_type`, `entity_id`, `domain_slug`),
	FOREIGN KEY (`domain_slug`) REFERENCES `domains`(`slug`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ed_domain_idx` ON `entity_domains` (`domain_slug`,`entity_type`);
--> statement-breakpoint
CREATE INDEX `ed_entity_idx` ON `entity_domains` (`entity_type`,`entity_id`);
