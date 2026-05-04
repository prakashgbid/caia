-- Multi-statement migration with breakpoints — matches the PR #287 fix shape.
CREATE TABLE foo (id TEXT PRIMARY KEY);
--> statement-breakpoint
CREATE INDEX foo_id ON foo(id);
--> statement-breakpoint
CREATE TABLE bar (id TEXT PRIMARY KEY, foo_id TEXT REFERENCES foo(id));
