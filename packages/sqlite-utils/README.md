# @chiefaia/sqlite-utils

Shared SQLite helpers for CAIA workspace packages. Thin wrappers over
[`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) for the
four primitives every existing CAIA sqlite consumer ends up writing
itself:

| helper | what it does |
| --- | --- |
| `openDb(path, opts?)` | open or create a DB; ensure parent dir; WAL + `synchronous=NORMAL` + `foreign_keys=ON` pragmas; read-only support |
| `migrate(db, dir, opts?)` | apply every `*.sql` in `dir` (lex-sort) once; tracked in `_migrations`; idempotent on re-run; transactional per-file |
| `withTransaction(db, fn, opts?)` | run `fn` inside a SQLite transaction; commit on return, roll back on throw; explicit `deferred` / `immediate` / `exclusive` modes |
| `prepareCachedStmt(db, sql)` | memoised `db.prepare(sql)` keyed by `(db, sql)` via WeakMap so prepared statements stay hot for the life of the connection |

## Why this package exists

Nine workspace packages today (`mentor-event-bus`, `llm-cache`,
`local-rag`, `librarian`, `mentor-retrieval`, `feature-registry`,
`architecture-registry`, `mentor-fastpath`, `test-isolation`) all do
some subset of the same five lines:

```ts
const db = new Database(path);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL'); // librarian, mentor-retrieval
db.pragma('foreign_keys = ON');    // mentor-event-bus, librarian, mentor-retrieval
db.exec(SCHEMA_STRING);            // llm-cache, local-rag (inline schema)
// or
applyMigrations(db, migrationsDir);// mentor-event-bus
```

A future change — e.g. adding `pragma('busy_timeout = 5000')` to
survive parallel-agent contention, or rotating the `_migrations`
tracking-table shape — currently means editing nine files. This
package centralises the surface so changes land once.

## Public surface

```ts
import {
  openDb,
  migrate,
  withTransaction,
  prepareCachedStmt,
  // also:
  isMigrationsInitialised,
  listAppliedMigrations,
  clearPreparedStmtCache,
  preparedStmtCacheSize,
  type Database,
  type OpenDbOptions,
  type MigrateOptions,
  type MigrationReport,
  type WithTransactionOptions,
  type TransactionMode,
} from '@chiefaia/sqlite-utils';
```

## Example: full lifecycle

```ts
import { openDb, migrate, withTransaction, prepareCachedStmt } from '@chiefaia/sqlite-utils';

const db = openDb('/data/events.sqlite');
const report = migrate(db, '/data/migrations');
console.log(`applied ${report.applied.length} migration(s); skipped ${report.skipped.length}`);

const insertEvent = prepareCachedStmt<[string, string]>(
  db,
  'INSERT INTO events (id, body) VALUES (?, ?)',
);

withTransaction(db, () => {
  insertEvent.run('evt-1', '{}');
  insertEvent.run('evt-2', '{}');
});

db.close();
```

## Tests

```sh
pnpm --filter @chiefaia/sqlite-utils test
```

The package's vitest suite covers the four primitives end-to-end —
opening WAL DBs vs `:memory:` vs read-only, applying / re-applying
migrations, transaction commit + rollback semantics, the prepare-cache
WeakMap behaviour. Tests use real on-disk SQLite (via `os.tmpdir()`),
not mocks — better-sqlite3 is synchronous and fast enough that mocking
it adds risk without saving wall-clock time.

## Migration notes (for consumers)

When migrating a package off its inline pragma/migration block:

1. Add `"@chiefaia/sqlite-utils": "workspace:*"` to `dependencies`.
2. Replace `new Database(path)` + the pragma block with `openDb(path)`.
3. If the package owns a migrations folder, replace the bespoke runner
   with `migrate(db, migrationsDir)`.
4. If the package builds its own statement cache via `this.insertStmt
   = this.db.prepare(...)` in a constructor, leave that pattern alone
   — the class-based cache is functionally equivalent and rewriting it
   adds churn for no behavioural delta. Only adopt `prepareCachedStmt`
   in new code or when the cache is being added for the first time.

`@chiefaia/test-isolation/sqlite` is intentionally NOT migrated to use
this package. That helper layers Drizzle on top of better-sqlite3 and
its surface is test-framework-focused (per-test ephemeral DBs with
auto-cleanup), which is a different concern from the generic open +
migrate + transact primitives here.

## Wire format / pragma stability

The pragmas this package sets (`journal_mode = WAL`, `synchronous =
NORMAL`, `foreign_keys = ON`) are byte-identical to what the donor
sites already set. Migrating off the inline blocks is a no-op for
on-disk DBs — the journal-mode flag persists across opens, the
synchronous/foreign_keys flags are per-connection but already
matching. There is no schema change at the migration boundary.
