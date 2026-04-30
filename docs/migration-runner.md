# Migration runner — quirks & recovery

> Reference for `apps/orchestrator/src/db/connection.ts :: runMigrations` and
> the surrounding drizzle wiring. Filed after the 2026-04-30 daemon-repoint
> incident (memory: `daemon_repoint_2026-04-30.md`).

## The runner

We use drizzle's stock `better-sqlite3` migrator:

```ts
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
// …
migrate(db, { migrationsFolder });
```

It reads `meta/_journal.json` from `migrationsFolder`, walks the entries in
order, and applies each `.sql` file inside a single `BEGIN`…`COMMIT`
transaction. The applied set is tracked in the `__drizzle_migrations` table.

## Quirk #1 — skip-logic is **timestamp-based**, not hash-based

For each entry in the journal, drizzle checks roughly:

```ts
const last = db
  .select(__drizzle_migrations)
  .orderBy(desc(created_at))
  .limit(1);

if (last && Number(last.created_at) < migration.folderMillis) {
  apply(migration);
}
```

Specifically, `migration.folderMillis` comes from the journal's `when` field
(a millisecond timestamp). The decision is purely the comparison
`last.created_at < migration.when`. The migration's SHA-256 hash is _stored_
on apply but never used to detect drift — drizzle does not re-apply or
warn on hash mismatch.

### What this means in practice

- **A DB whose `__drizzle_migrations.created_at` is in the future
  (e.g. populated by a manual recovery using `Date.now()` while the
  journal `when` values are pinned to a synthetic baseline like
  `1779200000000` ≈ 2026-05-15)** will appear "caught up" to drizzle and
  skip _every_ entry — including new ones — until the journal's `when`
  exceeds the stored timestamp.

- **Conversely, a DB whose latest `created_at` is small (`Date.now()` at
  ~2024 epoch) while journal `when` values are pinned far in the future**
  will cause drizzle to consider every journal entry pending and try to
  re-apply them. On `ALTER TABLE … ADD COLUMN` the re-apply fails
  ("duplicate column"), the surrounding transaction rolls back, and the
  daemon crashloops.

### Recovery recipe

If drizzle is misbehaving on boot:

1. Stop the daemon (`launchctl unload ~/Library/LaunchAgents/com.caia.orchestrator.plist`).
2. Take a backup snapshot of the SQLite DB.
3. For every `tag` in `meta/_journal.json` that's missing from
   `__drizzle_migrations.tag`, apply it manually:
   ```sh
   sqlite3 ~/.conductor/db.sqlite < src/db/migrations/<file>.sql
   ```
   then insert the `__drizzle_migrations` row with the SHA-256 hash from
   the journal entry.
4. **Critical:** update the most-recent `__drizzle_migrations.created_at`
   to a pinned future value such as `9_999_999_999_999`. This makes the
   per-entry `last.created_at < migration.when` test return `false` for
   every journal entry, so drizzle's startup migrate becomes a no-op
   instead of trying to re-apply already-applied migrations.
5. Reload the daemon and verify `/health` returns `{"ok":true}`.

## Quirk #2 — single-transaction-per-batch

Drizzle wraps the whole pending batch in one `BEGIN`…`COMMIT`. If
migration N fails, N-1 and earlier roll back too, even if the SQL was
syntactically valid. Recovery requires bypassing drizzle (apply each
file manually with `sqlite3 < .sql`, then insert `__drizzle_migrations`
rows).

## Quirk #3 — journal is the source of truth, not the on-disk filename

A `.sql` file with no matching `meta/_journal.json` entry is silently
ignored by the runner. Two files sharing a numeric prefix
(`0037_a.sql`, `0037_b.sql`) is fine on disk but only the one with a
matching journal `tag` will ever be applied.

We hit this on 2026-04-30: `0037_irreversible_actions.sql` lived next
to `0037_story_capsule.sql` but only the latter was journalled, so the
broker ledger table was never created on a fresh DB. Fix: renumber the
orphan to the next free idx (`0041_irreversible_actions.sql`) and add
the journal entry. PR
[`fix/orchestrator-migration-0037-journal-add`](https://github.com/prakashgbid/caia/pulls?q=fix%2Forchestrator-migration-0037-journal-add).

## Authoring rules — keep new migrations safe

When adding a new migration:

- **Set the journal `when`** strictly greater than the previous entry's
  `when`. We currently increment by `100_000_000_000` (≈ 3 years) per
  slot to keep ordering robust against `Date.now()` drift.
- **Always include `--> statement-breakpoint`** between top-level
  statements. drizzle splits the `.sql` into individual statements at
  these markers; missing markers cause `better-sqlite3` to refuse the
  multi-statement string with `Error: This statement does not return data`.
- **Use backticked identifiers** for table and column names — the rest
  of the dialect normalisation is whitespace-sensitive.
- **Use `IF NOT EXISTS` on every CREATE** so a re-apply (e.g. if quirk #1
  bites) doesn't crash the runner.
- **`pnpm build` must mirror `src/db/migrations/` into `dist/src/db/migrations/`**
  — see `apps/orchestrator/package.json :: postbuild:copy-migrations`
  ([PR](https://github.com/prakashgbid/caia/pulls?q=chore%2Forchestrator-migrations-copy-to-dist)).
  `tsc` does not copy non-`.ts` assets and will silently leave the dist
  tree with a partial set otherwise.

## Verifying after a fresh build

```sh
diff <(ls apps/orchestrator/src/db/migrations/*.sql  | xargs -n1 basename) \
     <(ls apps/orchestrator/dist/src/db/migrations/*.sql | xargs -n1 basename)
# ↑ should be empty.

sqlite3 ~/.conductor/db.sqlite "SELECT COUNT(*) FROM __drizzle_migrations;"
# ↑ should match the journal entry count.

curl -s http://localhost:7776/health
# ↑ {"ok":true,"db":"connected","schema":"v2"}
```

## See also

- `daemon_repoint_2026-04-30.md` — the case study that motivated this doc.
- `caia/docs/git-flow.md` — for shipping the
  `docs/orchestrator-migration-runner-quirk` PR through `pnpm flow`.
