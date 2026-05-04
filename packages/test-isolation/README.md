# @chiefaia/test-isolation

Per-test isolation primitives for parallel test runs.

## What's here

| Module | Status | Purpose |
|---|---|---|
| `./sqlite` | landed (FIX-008) | Per-test ephemeral SQLite — one file per test, deleted on teardown |
| `./ports` | pending (FIX-009) | Per-test localhost port allocator |

## Why

The Fix-It Test Agent runs hundreds of E2E tests in parallel — locally
on Playwright workers (FIX-010) and remotely on Browserless (FIX-007).
Two tests racing on the same database or the same TCP port produce
flakes that take days to reproduce. This package eliminates both
classes by giving every test its own resources up front.

## SQLite (FIX-008)

```ts
import { afterEach, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@chiefaia/test-isolation/sqlite';
import * as schema from './schema';   // your Drizzle schema

let testDb: TestDb<typeof schema>;

beforeEach(() => {
  testDb = createTestDb({
    migrationsFolder: 'src/db/migrations',
    schema,
  });
});

afterEach(() => testDb.cleanup());

test('it works', () => {
  testDb.db.insert(schema.users).values({ name: 'alice' }).run();
  // ... assertions ...
});
```

What you get:

- A unique SQLite file at `${os.tmpdir()}/caia-test-<uuid>.sqlite`
- Drizzle migrations applied from `migrationsFolder` before the call returns
- Same pragmas as production (`journal_mode = WAL`, `foreign_keys = ON`)
- Best-effort cleanup on `process.exit` so a killed runner doesn't leave junk
- TypeScript 5.2+ `using` declarations work via `Symbol.dispose`

### Sweeping stale files

```ts
import { sweepStaleTestDbs } from '@chiefaia/test-isolation/sqlite';

// In a periodic cleaner (FIX-013), e.g. every 15 min:
const removed = sweepStaleTestDbs({ maxAgeMs: 60 * 60 * 1000 });
console.log(`removed ${removed.length} stale test DBs`);
```

### Observability

```ts
import { listLiveTestDbs } from '@chiefaia/test-isolation/sqlite';

// Used by the FIX-013 dashboard panel.
listLiveTestDbs();   // ['/tmp/caia-test-...', ...]
```

The returned array is frozen — you can read but not mutate it.

## Why a separate file per test, not `:memory:`?

Production uses disk-backed SQLite (`apps/orchestrator/src/db/connection.ts`).
The disk engine has quirks the in-memory engine doesn't (text-typed
integers, JSON-as-text, WAL semantics) and we want tests to catch them.
Spawning a fresh disk file is ~5 ms on tmpfs (Linux) or APFS (macOS) —
comparable to opening an in-memory connection.

## Why a separate file per test, not per worker?

Per-worker recycling sounds appealing — fewer migrations, faster setup.
But the Drizzle migration cost on a fresh file is ~10 ms; cumulatively
under a second for an entire test suite. The bug-prevention payoff
(zero leakage across tests) is worth it.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `ENOENT` on migrations dir | Wrong `migrationsFolder` | Pass an absolute path or one resolved from `import.meta.url` |
| WAL/SHM files left behind | Process killed mid-test before cleanup | The `process.on('exit')` hook fires on normal termination; for SIGKILL use `sweepStaleTestDbs` |
| Slow tests | Repeated migration on every test | Expected — each test gets a fresh schema |

## Roadmap

- FIX-009 — port allocator (`./ports`)
- FIX-013 — dashboard panel reading from `listLiveTestDbs()`
