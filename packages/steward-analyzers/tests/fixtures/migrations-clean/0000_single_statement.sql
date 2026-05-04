-- A single-statement migration. Always fine, no breakpoint needed.
CREATE TABLE single_table (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
