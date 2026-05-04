# @chiefaia/test-isolation

Per-test isolation primitives for parallel test runs.

## What's here

| Module | Status | Purpose |
|---|---|---|
| `./sqlite` | landed (FIX-008) | Per-test ephemeral SQLite — one file per test, deleted on teardown |
| `./ports` | landed (FIX-009) | Per-test localhost port allocator |

## Why

The Fix-It Test Agent runs hundreds of E2E tests in parallel — locally
on Playwright workers (FIX-010) and remotely on Browserless (FIX-007).
Two tests racing on the same database, or on the same TCP port,
produce flakes that take days to reproduce. This package eliminates
both classes by giving every test its own resources up front.

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

test('does a thing', () => {
  testDb.db.insert(schema.users).values({ name: 'alice' }).run();
});
```

You get:

- A unique SQLite file at `${os.tmpdir()}/caia-test-<uuid>.sqlite`
- Drizzle migrations applied from `migrationsFolder` before the call returns
- Same pragmas as production (`journal_mode = WAL`, `foreign_keys = ON`)
- Best-effort cleanup on `process.exit`
- TypeScript 5.2+ `using` declarations work via `Symbol.dispose`

Sweep stale files with `sweepStaleTestDbs({ maxAgeMs })`. Inspect live
DBs with `listLiveTestDbs()` (used by the FIX-013 dashboard panel).

## Ports (FIX-009)

```ts
import { afterEach, beforeEach } from 'vitest';
import {
  allocateTestPort,
  allocateTestPortRange,
  releaseTestPort,
} from '@chiefaia/test-isolation/ports';

let port: number;
beforeEach(async ({ task }) => {
  port = await allocateTestPort({ testId: task.id });
  // boot your server bound to `port`
});
afterEach(() => releaseTestPort(port));

// Multi-port (orchestrator + dashboard + stub):
const [orch, dash, stub] = await allocateTestPortRange({
  testId: task.id,
  count: 3,
});
```

You get:

- A free port (or block of consecutive ports) on `127.0.0.1`
- Deterministic starting offset — `start = 30000 + sha1(testId) mod 5000` —
  so the same test always lands on the same port across runs (great
  for reproducing failures)
- Forward probe with `EADDRINUSE` fallback — collisions are rare, but
  recoverable
- Default range `[30000, 34999]` — well above the user-port floor and
  below the IANA dynamic range
- `listClaimedTestPorts()` for the FIX-013 dashboard panel

## Why disk-backed SQLite, not `:memory:`?

Production uses disk-backed SQLite. The disk engine has quirks the
in-memory engine doesn't (text-typed integers, JSON-as-text, WAL
semantics) and we want tests to catch them. A fresh disk file opens
in ~1.8 ms — comparable to `:memory:`.

## Why a separate file per test, not per worker?

Per-worker recycling sounds appealing — fewer migrations, faster
setup. But the Drizzle migration cost on a fresh file is ~1.8 ms;
cumulatively under a second for an entire test suite. The
bug-prevention payoff (zero leakage across tests) is worth it.

## Why hash + probe for ports, not pure `server.listen(0)`?

`server.listen(0)` asks the kernel for a free ephemeral port. It works
for ONE port at a time but two parallel tests can race on it (TOCTOU).
And it can't give you a *block* of consecutive ports.

Hash + forward probe gives:
- Deterministic offsets per test → parallel collisions are rare
- Block allocation for tests that need adjacent ports
- The probe fails-fast on `EADDRINUSE` so we recover from collisions

This is the same shape `pytest-xdist` and Playwright's worker fixtures use.

## Performance (reference)

Measured on an M1 Pro, vitest 1.6 + better-sqlite3 12.6:

| Operation | mean | ops/sec |
|---|---|---|
| `createTestDb` + `cleanup` | 1.7 ms | ~600 |
| `createTestDb` + 10 inserts + `cleanup` | 1.9 ms | ~530 |
| `allocateTestPort` + `releaseTestPort` | 18 µs | ~57 000 |
| `allocateTestPortRange(count: 3)` + release | 47 µs | ~21 000 |

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `ENOENT` on migrations dir | Wrong `migrationsFolder` | Pass an absolute path or one resolved from `import.meta.url` |
| WAL/SHM files left behind | Process killed mid-test before cleanup | Normal exit fires the registered hook; for SIGKILL use `sweepStaleTestDbs` |
| Port allocator throws "could not allocate" | Range exhausted (rare) | Raise `ceiling` or `maxAttempts`; check for runaway servers via `listClaimedTestPorts()` |
| Test is reproducibly assigned a port held by another tool | Hash collision + that port stuck | Pass `floor` / `ceiling` to relocate to a different range |

## Roadmap

- FIX-013 — dashboard panel reading from `listLiveTestDbs()` + `listClaimedTestPorts()`
