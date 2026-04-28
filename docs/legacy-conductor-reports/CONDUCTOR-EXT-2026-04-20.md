# Conductor Requirements Management Extension
**Date:** 2026-04-20
**Status:** COMPLETE — all tests green, TypeScript clean

---

## Summary

Extended Conductor with a full Requirements Management layer enabling a fully autonomous requirement-to-execution pipeline. Users describe requirements casually; the system refines, specs, queues, spawns, and notifies — without ever blocking for user approval.

---

## Modules Added

### `src/requirements/`
| File | Purpose |
|------|---------|
| `types.ts` | `Requirement`, `RequirementState`, `RequirementEvent`, `RequirementsState`, `PumpTickResult`, `ListRequirementsFilter` interfaces |
| `state-machine.ts` | `VALID_TRANSITIONS` map + `canTransition()` / `assertTransition()` guards |
| `manager.ts` | `RequirementsManager` class — event-sourced CRUD, state machine enforcement, cycle detection, snapshot + JSONL persistence |
| `migrate.ts` | `migrateFromBacklog()` — seeds requirements from `.auto-memory/backlog/*.md` BL-* files |

### `src/notifications/`
| File | Purpose |
|------|---------|
| `index.ts` | `NotificationQueue` — enqueue/drain, macOS `osascript` native notifications, graceful file-log fallback, module-level singleton |

### `src/pump/`
| File | Purpose |
|------|---------|
| `index.ts` | `PumpEngine` — `tick()` selects highest-priority eligible requirement (deps done + no file conflicts), claims it, builds task prompt, enqueues started notification. `onTaskCompleted()` marks done. |

---

## Modified Files

| File | Change |
|------|--------|
| `src/mcp/server.ts` | +12 new MCP tools (10 requirement tools + 2 notification tools + pump tick); initializes `RequirementsManager`, `NotificationQueue`, `PumpEngine` alongside `Conductor` |
| `src/http/health.ts` | +6 REST endpoints: `GET/POST /requirements`, `GET/PUT /requirements/:id`, `POST /requirements/:id/state`, `POST /requirements/:id/notes` |
| `dashboard/app/page.tsx` | Added tabbed navigation (Tasks / Requirements); imports `RequirementsKanban` |
| `dashboard/components/RequirementsKanban.tsx` | **New** — kanban board with 9 state columns, drag-drop, detail drawer, create-new modal, filter chips, auto-refresh 3s |
| `dashboard/app/api/requirements/route.ts` | **New** — Next.js proxy route for requirements CRUD |
| `templates/CLAUDE.md` | Added Requirements Management section: on-every-turn protocol, capture instructions, "never block on approvals" rule, MCP tool reference |

---

## Persistence

| File | What it stores |
|------|---------------|
| `~/.conductor/requirements.jsonl` | Append-only event log for all requirement mutations |
| `~/.conductor/requirements.snapshot.json` | Materialized state — fast load on startup |
| `~/.conductor/backups/requirements-YYYY-MM-DD.json` | Daily automatic backup |

---

## New MCP Tools (12 total)

| Tool | Description |
|------|-------------|
| `requirement_capture` | Capture requirement from casual description → `req_XXXX` |
| `requirement_refine` | Update description, spec, files, labels, priority |
| `requirement_set_state` | Enforce valid transitions (throws on illegal transition) |
| `requirement_add_dependency` | Cycle-checked dependency between requirements |
| `requirement_list` | Filter by state/priority/labels |
| `requirement_show` | Full detail for one requirement |
| `requirement_pickup_next` | Claim highest-priority eligible `ready` requirement → `executing` |
| `requirement_mark_done` | Move `executing`/`verifying` → `done` |
| `notification_enqueue` | Push to queue + fire native macOS notification |
| `notification_drain` | Return + clear pending chat notifications (call on every heartbeat) |
| `conductor_pump_tick` | Single pump cycle: pick + claim + return prompt + cwd |

---

## Test Results

```
Test Suites: 12 passed, 12 total
Tests:       182 passed, 182 total
  ├── Existing (82)  — core, mcp, hook, dashboard — ALL STILL PASS
  └── New (100):
      ├── requirements/state-machine.test.ts  — 25 tests
      ├── requirements/dependency.test.ts     — 11 tests
      ├── requirements/manager.test.ts        — 28 tests
      ├── pump/tick.test.ts                   — 16 tests
      ├── notifications/enqueue-drain.test.ts — 16 tests
      └── e2e/capture-to-done.test.ts         —  4 tests
```

---

## Requirement State Machine

```
                                  ┌──────────────────────────┐
captured ──► refining ──► specced ──► ready ──► executing ──► verifying ──► done
    ▲             │                    │            │
    └─────────────┘         cancelled ◄┴────────────┘
                                                   │
                                                blocked ──► ready
```

Valid transitions enforce invariants — `assertTransition()` throws with exact message including allowed next states.

---

## Example: Full Capture → Done Flow

```typescript
// 1. User says "I need login with email + password"
const req = await requirement_capture({
  title: "User authentication",
  description: "Users need to log in with email and password",
  targetProject: "~/projects/my-app",
  labels: ["backend", "auth"],
  priority: 2,
});
// → { id: "req_A7b3Xk2c", state: "captured", ... }

// 2. Orchestrator refines it
await requirement_refine(req.id, {
  estimatedFiles: ["src/auth/**", "src/api/login.ts"],
  spec: {
    goals: ["JWT-based login", "bcrypt password hashing"],
    nonGoals: ["OAuth", "SSO"],
    acceptanceCriteria: [
      "POST /auth/login returns JWT",
      "Invalid credentials return 401",
    ],
    notes: "Use existing User model",
  },
});

// 3. Advance to ready (or orchestrator does this automatically)
await requirement_set_state(req.id, "refining");
await requirement_set_state(req.id, "specced");
await requirement_set_state(req.id, "ready");

// 4. Heartbeat fires → pump tick claims it
const tick = await conductor_pump_tick();
// → { picked: { id: "req_A7b3Xk2c", state: "executing" }, prompt: "...", cwd: "~/projects/my-app" }

// 5. Spawn code task with tick.prompt in tick.cwd
const taskId = await start_code_task({ prompt: tick.prompt, cwd: tick.cwd });

// 6. [Native notification fires]: "Requirement 'User authentication' started"
// [Chat notification via drain]: same message

// 7. Task completes → mark done
await requirement_mark_done(req.id);
// → [Native + chat notification]: "Requirement 'User authentication' done"
```

---

## Dashboard

The Requirements tab at `localhost:7777` provides:
- **9-column Kanban** board (one column per state), color-coded
- **Drag-drop** cards between columns to trigger state transitions
- **Detail drawer** — click any card to see description, spec, AC, notes, linked tasks, dependencies
- **Create modal** — "New Requirement" button captures title, description, project, priority, labels
- **Filter chips** — narrow view to single state with live counts
- **Auto-refresh** every 3 seconds

---

## Pump Autonomy Engine

`PumpEngine.tick()` runs this atomic selection cycle:
1. List all `ready` requirements, filtered to those with all `dependsOn` in `done` state
2. Exclude any with `estimatedFiles` that overlap (via picomatch) with currently `executing` requirements
3. Sort by `priority` (1=highest) then `capturedAt` (oldest first)
4. Claim the first eligible one → set state to `executing`
5. Build self-contained task prompt (includes spec, AC, files, conductor tag)
6. Return `{ picked, prompt, cwd }` to caller for spawning
7. Enqueue `started` native + chat notification

The orchestrator calls `conductor_pump_tick()` on every heartbeat and every user turn. No human approval needed.

---

## Heartbeat Integration

The existing `orchestrator-heartbeat-15min` scheduled task fires → orchestrator session receives notification → calls two tools:
1. `notification_drain()` — surface any queued notifications to user
2. `conductor_pump_tick()` — if a requirement is ready, get prompt + spawn task

No changes to the heartbeat scheduled task itself. The orchestrator-side logic is documented in `templates/CLAUDE.md`.

---

## Migration

`src/requirements/migrate.ts` exports `migrateFromBacklog(backlogDir, reqManager)`.
Reads `BL-*.md` files, parses YAML frontmatter (`status`, `priority`, `labels`, `title`), maps legacy statuses (`backlog`→`captured`, `complete`→`done`), extracts Goals/Acceptance Criteria/Files sections. No `.auto-memory/backlog/` directory found at migration time — no records seeded, but the module is ready for future use.
