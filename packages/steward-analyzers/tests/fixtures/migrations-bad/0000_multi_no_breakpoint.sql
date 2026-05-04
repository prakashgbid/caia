-- The shape that broke PR #287. Multiple statements, no breakpoint markers.
CREATE TABLE foo (id TEXT PRIMARY KEY);
CREATE INDEX foo_idx ON foo(id);
CREATE TABLE bar (id TEXT PRIMARY KEY);
