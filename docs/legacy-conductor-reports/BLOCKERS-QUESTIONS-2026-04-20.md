# Blockers & Questions — Implementation Report
**Date:** 2026-04-20  
**Build:** ✅ green  
**Tests:** 237 passed (182 existing + 55 new), 0 failed

---

## 1. Overview

Two first-class concepts added to Conductor: **Blockers** (action items on the user) and **Questions/Clarifications** (input needed before work can continue). Both surface in the dashboard as dedicated kanban tabs with zero-friction resolution.

---

## 2. Schema

### Blocker

```
~/.conductor/blockers.jsonl         ← append-only event log
~/.conductor/blockers.snapshot.json ← materialized state
```

Event types: `BLOCKER_CREATED` · `BLOCKER_RESOLVED` · `BLOCKER_CANCELLED` · `BLOCKER_SNAPSHOT_REBUILT`

**States:** `open → resolved | cancelled`  
**ID prefix:** `blk_XXXX`

Fields: `id, title, createdAt, state, severity (critical|high|normal|low), kind (approval|credentials|dns|external-setup|info|decision), description, resolutionSteps[], approvalButton?, links?, requirementId?, taskId?, resolvedAt?, resolvedBy?, resolutionNote?`

### Question

```
~/.conductor/questions.jsonl         ← append-only event log
~/.conductor/questions.snapshot.json ← materialized state
```

Event types: `QUESTION_CREATED` · `QUESTION_ANSWERED` · `QUESTION_CANCELLED` · `QUESTION_SNAPSHOT_REBUILT`

**States:** `open → answered | cancelled`  
**ID prefix:** `qst_XXXX`

Fields: `id, title, createdAt, state, priority (urgent|normal|nice-to-have), context, recommendations[]{id,label,rationale,isDefault?}, customAnswerPlaceholder?, requirementId?, taskId?, answeredAt?, answer?{kind,recommendationId?,customText?}`

---

## 3. File List

### New source files (16)

```
src/blockers/types.ts
src/blockers/state-machine.ts
src/blockers/manager.ts
src/questions/types.ts
src/questions/state-machine.ts
src/questions/manager.ts
src/mcp/seed.ts
dashboard/components/BlockersKanban.tsx
dashboard/components/QuestionsKanban.tsx
dashboard/app/api/blockers/route.ts
dashboard/app/api/blockers/[id]/route.ts
dashboard/app/api/blockers/[id]/resolve/route.ts
dashboard/app/api/questions/route.ts
dashboard/app/api/questions/[id]/route.ts
dashboard/app/api/questions/[id]/answer/route.ts
dashboard/app/api/counts/route.ts
```

### New test files (5)

```
tests/blockers/state-machine.test.ts    — 13 tests
tests/blockers/approval-payload.test.ts — 6 tests
tests/questions/state-machine.test.ts   — 13 tests
tests/questions/custom-answer.test.ts   — 10 tests
tests/mcp/drain.test.ts                 — 10 tests (5 blocker + 5 question)
```

### Modified files (4)

```
src/http/health.ts            — added /blockers, /questions, /counts endpoints
src/mcp/server.ts             — added 8 MCP tools, wired BlockersManager + QuestionsManager
dashboard/app/page.tsx        — added 🚨 Blockers + ❓ Questions tabs, count badges
templates/CLAUDE.md           — added blocker_drain + question_drain to heartbeat protocol
```

---

## 4. Test Counts

| Suite | Tests |
|-------|-------|
| blockers/state-machine | 13 |
| blockers/approval-payload | 6 |
| questions/state-machine | 13 |
| questions/custom-answer | 10 |
| mcp/drain | 10 (5 blocker + 5 question) |
| **New total** | **52** |
| Existing suite | 182 |
| **Grand total** | **237** ✅ |

---

## 5. Seed Data Loaded

Seeded on MCP server startup (idempotent — checks by title before creating):

| Type | Title | State |
|------|-------|-------|
| Blocker | Add DNS CNAME for roulettecommunity.com | open |
| Blocker | Create 2 GA4 Properties in Google Analytics | open |
| Blocker | Enable Cloudflare R2 in dashboard (one-time) | **resolved** (historical) |
| Question | Conductor auto-kill of stalled tasks — enable by default or keep opt-in? | open (3 recommendations) |
| Question | Pixabay pending approval — proceed with Unsplash+Pexels only, or wait? | open (2 recommendations) |

---

## 6. MCP Tool List

| Tool | Description |
|------|-------------|
| `blocker_create` | Create blocker, fire macOS notification |
| `blocker_list` | List blockers, optional state filter |
| `blocker_resolve` | Resolve a blocker (also callable from dashboard) |
| `blocker_drain` | Return+clear newly-resolved blockers since last call |
| `question_create` | Create question, fire macOS notification |
| `question_list` | List questions, optional state filter |
| `question_answer` | Submit answer (also callable from dashboard) |
| `question_drain` | Return+clear newly-answered questions since last call |

### Example curl calls

```bash
# Create a blocker
curl -s -X POST http://localhost:7776/blockers \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Enable Stripe webhooks",
    "severity": "high",
    "kind": "external-setup",
    "description": "Stripe webhook endpoint must be registered in the Stripe dashboard.",
    "resolutionSteps": [
      {"order":1,"instruction":"Go to dashboard.stripe.com → Webhooks → Add endpoint","verification":"Endpoint shows status Active"}
    ]
  }'

# List open blockers
curl -s 'http://localhost:7776/blockers?state=open'

# Resolve a blocker
curl -s -X POST http://localhost:7776/blockers/blk_XXXX/resolve \
  -H 'Content-Type: application/json' \
  -d '{"note":"Done — webhook registered"}'

# Create a question
curl -s -X POST http://localhost:7776/questions \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Which CDN?",
    "priority": "normal",
    "context": "We need to pick a CDN for image delivery.",
    "recommendations": [
      {"id":"rec_A","label":"Cloudflare","rationale":"Already in our account","isDefault":true},
      {"id":"rec_B","label":"Fastly","rationale":"Better analytics"}
    ]
  }'

# Submit a recommendation answer
curl -s -X POST http://localhost:7776/questions/qst_XXXX/answer \
  -H 'Content-Type: application/json' \
  -d '{"kind":"accepted-recommendation","recommendationId":"rec_A"}'

# Submit a custom answer
curl -s -X POST http://localhost:7776/questions/qst_XXXX/answer \
  -H 'Content-Type: application/json' \
  -d '{"kind":"custom","customText":"Use Bunny CDN for better price/performance"}'

# Count badges (for dashboard header)
curl -s http://localhost:7776/counts
# → {"openBlockers":2,"openQuestions":2}
```

---

## 7. Orchestrator Integration (Heartbeat)

`templates/CLAUDE.md` updated. On **every heartbeat**:

```typescript
// After notification_drain(), before requirement_pickup_next():

const blockerDrain = await conductor_mcp.blocker_drain();
for (const { blocker, approvalPayload } of blockerDrain.resolvedBlockers) {
  // Surface resolution to user; use approvalPayload to resume paused work
}

const questionDrain = await conductor_mcp.question_drain();
for (const { question } of questionDrain.answeredQuestions) {
  // Surface answer to user; use question.answer to continue paused decision path
}
```

**Loop closed:** user clicks "Approve" or "Submit answer" in dashboard → HTTP route hits `blockersManager.resolve()` / `questionsManager.answer()` → item added to `pendingDrain` in-memory queue → next heartbeat calls `blocker_drain()` / `question_drain()` → orchestrator receives resolution → work resumes automatically.

---

## 8. Dashboard

**URL:** http://localhost:7777

Two new tabs added alongside Tasks and Requirements:

- **🚨 Blockers** — three-column kanban (Open / Resolved / Cancelled)
  - Card: severity badge, kind badge, description, resolution steps accordion, approval button (one-click resolve), links, manual resolve with note
  - Empty state: "Nothing waiting for you right now — Conductor is running autonomously."
  - Count badge in header (red, visible from any tab): `2`

- **❓ Questions** — three-column kanban (Open / Answered / Cancelled)
  - Card: priority badge, context block, recommendation radio list with rationale, custom textarea, Submit button
  - Default recommendation highlighted
  - Once answered: card moves to Answered column with answer summary
  - Empty state friendly message

**A11y:**
- `role="tablist"` + `role="tab"` + `aria-selected` + `aria-controls` on nav
- `role="tabpanel"` + `id` on panels
- `aria-live="polite"` on count badges
- Resolution animation respects `prefers-reduced-motion`

**Resolution animation:** CSS `@keyframes confetti-pop` — card scales 1 → 1.15 → 1 on resolve/answer, then flies to resolved column after 500ms. Disabled when `prefers-reduced-motion: reduce`.

---

## 9. Native Notifications

When `blocker_create` or `question_create` is called (via MCP or HTTP):

```
Title:    PokerZeno Conductor
Subtitle: Blocker needs you  (or: Question for you)
Body:     <item title>
```

Implemented via `osascript`; best-effort — silently ignores errors.
