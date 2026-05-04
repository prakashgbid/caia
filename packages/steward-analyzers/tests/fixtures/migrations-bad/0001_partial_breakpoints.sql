-- Some breakpoints present, but not enough — 4 statements need 3 breakpoints; this has 1.
CREATE TABLE a (id TEXT PRIMARY KEY);
--> statement-breakpoint
CREATE TABLE b (id TEXT PRIMARY KEY);
CREATE TABLE c (id TEXT PRIMARY KEY);
CREATE TABLE d (id TEXT PRIMARY KEY);
