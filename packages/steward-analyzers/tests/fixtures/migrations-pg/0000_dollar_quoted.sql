-- Postgres-style dollar-quoted body. Body contains semicolons but they
-- must not be counted as top-level statement terminators.
CREATE FUNCTION ping() RETURNS TEXT AS $$
  DECLARE x INT;
  BEGIN
    x := 1;
    RETURN 'pong;pong';
  END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TABLE pings (id TEXT PRIMARY KEY);
