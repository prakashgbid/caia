# Dashboard URL schema — canonical convention

> **Status:** active. Source of truth for the IA. Every route under
> `apps/dashboard/app/` must conform to this schema; the `Breadcrumb`
> component (DASH-003) parses `usePathname()` against it.

---

## 1. Top-level groups (≤7)

The left nav is partitioned into six accordion sections. Each section has
a landing page at `/<section>`; every leaf route lives one or more levels
below the section root.

| # | Section | URL prefix | One-liner |
|---|---|---|---|
| 1 | **Work** | `/work` | The Jira-like task board. Prompts, stories, tasks, queue, blockers, requirements, suggestions, submit. |
| 2 | **Pipeline** | `/pipeline` | Run-time / what's happening right now. Timeline, pipeline, events, task-runs, DAG. |
| 3 | **Catalog** | `/catalog` | What exists. Architecture (AKG), contracts (ACR), feature registry (FREG), domains, projects, agents, registry. |
| 4 | **Quality** | `/quality` | Gates + evidence. Tests, completeness, gates, the quality dashboard. |
| 5 | **Operations** | `/operations` | Live ops. Platform status, health, observability, metrics, audit, builds. |
| 6 | **Settings** | `/settings` | Settings, ADRs, standards. |

The legacy `/pipeline` page (the 878-line live pipeline view) becomes the
section landing. Pipeline-family routes nest under `/pipeline/*`.

---

## 2. Canonical drill-down pattern

`/<section>/<resource>[/<id>][/<sub-resource>][/<id>]…`

### Work

```
/work                                         — section landing
/work/submit                                  — prompt-submission UI
/work/prompts                                 — list of all prompts
/work/prompts/[id]                            — single prompt summary
/work/prompts/[id]/journey                    — journey view
/work/prompts/[id]/pipeline                   — pipeline scoped to this prompt
/work/prompts/[id]/pipeline/[stageId]         — single-stage detail
/work/prompts/[id]/stories                    — stories scoped to this prompt
/work/prompts/[id]/stories/[storyId]          — story detail
/work/prompts/[id]/stories/[storyId]/tasks    — tasks scoped to story
/work/prompts/[id]/stories/[storyId]/tasks/[taskId]
/work/stories                                 — flat stories index
/work/stories/[id]                            — story detail
/work/tasks                                   — flat tasks index
/work/tasks/[id]                              — task detail
/work/queue                                   — priority queue
/work/buckets                                 — ticket bundles
/work/blockers                                — kanban
/work/blockers/[id]
/work/requirements                            — requirements list
/work/requirements/[id]
/work/questions                               — clarifications
/work/questions/[id]
/work/suggestions                             — agent follow-ups
```

### Pipeline

```
/pipeline                                     — live pipeline view
/pipeline/timeline                            — chronological event feed
/pipeline/events                              — raw event stream
/pipeline/task-runs                           — task-run list
/pipeline/task-runs/[session_id]
/pipeline/dag                                 — dependency graph
```

### Catalog

```
/catalog                                      — section landing
/catalog/projects
/catalog/projects/[slug]
/catalog/domains
/catalog/domains/[slug]
/catalog/architecture                         — AKG dashboard
/catalog/contracts                            — ACR registry
/catalog/features
/catalog/features/[id]
/catalog/agents
/catalog/agents/[agentId]                     — drill target for the agent rail (DASH-005)
/catalog/registry
/catalog/registry/[entityKind]/[entityId]
```

### Quality

```
/quality                                      — section landing
/quality/gates                                — human-gate artifacts
/quality/tests
/quality/tests/[id]
/quality/completeness
```

### Operations

```
/operations                                   — section landing (was /platform-status)
/operations/health                            — heartbeat + canary (was /health/pulse)
/operations/observability                     — event-types
/operations/metrics
/operations/metrics/llm
/operations/metrics/phase1
/operations/builds
/operations/builds/[id]
/operations/audit
/operations/audit/[entityKind]/[entityId]
```

### Settings

```
/settings
/settings/standards
/settings/adrs
/settings/adrs/[number]
```

---

## 3. Filter shortcuts

Project-scoped views use a query param, NOT a path segment:

```
/work?project=<slug>
/pipeline/timeline?project=<slug>
/operations/audit?project=<slug>
```

Old `/projects/[slug]/timeline`, `/projects/[slug]/blockers` etc. are
redirect stubs that point at the new filtered top-level path.

Other filters (status, scope, age, agent) are also query params:

```
/work/prompts?status=in_pipeline&scope=epic
/work/tasks?status=blocked&agent=designer
```

---

## 4. Redirect map (old → new) — implemented in PR2

The old top-level URLs continue to work for backwards compatibility (no
broken bookmarks). Each is wired to a Next.js redirect via
`apps/dashboard/redirects.js`.

| Old | New |
|---|---|
| `/timeline` | `/pipeline/timeline` |
| `/queue` | `/work/queue` |
| `/buckets` | `/work/buckets` |
| `/tasks` / `/tasks/[id]` | `/work/tasks` / `/work/tasks/[id]` |
| `/task-runs` / `/task-runs/[session_id]` | `/pipeline/task-runs` / `/pipeline/task-runs/[session_id]` |
| `/requirements` / `/requirements/[id]` | `/work/requirements` / `/work/requirements/[id]` |
| `/blockers` / `/blockers/[id]` | `/work/blockers` / `/work/blockers/[id]` |
| `/questions` / `/questions/[id]` | `/work/questions` / `/work/questions/[id]` |
| `/adrs` / `/adrs/[number]` | `/settings/adrs` / `/settings/adrs/[number]` |
| `/features` / `/features/[id]` | `/catalog/features` / `/catalog/features/[id]` |
| `/suggestions` | `/work/suggestions` |
| `/audit` / `/audit/[entityKind]/[entityId]` | `/operations/audit` / `/operations/audit/[entityKind]/[entityId]` |
| `/tests` / `/tests/[id]` | `/quality/tests` / `/quality/tests/[id]` |
| `/stories` / `/stories/[id]` | `/work/stories` / `/work/stories/[id]` |
| `/completeness` | `/quality/completeness` |
| `/standards` | `/settings/standards` |
| `/metrics` / `/metrics/llm` / `/metrics/phase1` | `/operations/metrics` / `/operations/metrics/llm` / `/operations/metrics/phase1` |
| `/registry` | `/catalog/registry` |
| `/events` | `/pipeline/events` |
| `/builds` / `/builds/[id]` | `/operations/builds` / `/operations/builds/[id]` |
| `/observability/health` | `/operations/observability` |
| `/health/pulse` | `/operations/health` |
| `/dag` | `/pipeline/dag` |
| `/projects` / `/projects/[slug]` | `/catalog/projects` / `/catalog/projects/[slug]` |
| `/domains` / `/domains/[slug]` | `/catalog/domains` / `/catalog/domains/[slug]` |
| `/agents` | `/catalog/agents` |
| `/architecture` | `/catalog/architecture` |
| `/contracts` | `/catalog/contracts` |
| `/gates` | `/quality/gates` |
| `/platform-status` | `/operations` |
| `/prompts` / `/prompts/[id]` / `/prompts/[id]/journey` | `/work/prompts` / `/work/prompts/[id]` / `/work/prompts/[id]/journey` |
| `/submit` | `/work/submit` |
| `/reports/prompts` | `/work/prompts/reports` |
| `/backups` | `/operations` (page deprecated, PR6) |
| `/coverage` | `/quality` (page deprecated, PR6) |
| `/enforcement` | `/quality/gates` (page deprecated, PR6) |

---

## 5. Breadcrumb derivation

Every drill-down page renders a breadcrumb derived from the URL path.
Component: `apps/dashboard/components/Breadcrumb.tsx` (DASH-003). Parses
`usePathname()` left-to-right.

### Rules

1. **Section root** is always the first crumb. (`/work` → `Work`.)
2. **Static segments** map via `SEGMENT_LABELS` (e.g. `prompts` → `Prompts`).
3. **Dynamic segments** (`[id]`, `[slug]`, etc.) render as the raw value
   truncated to 12 chars, with a tooltip showing the full value.
4. **Final crumb** is non-clickable and has `aria-current="page"`.

### Example

URL: `/work/prompts/prm_01HQX84/stories/story_42/tasks/task_99`

```
Work › Prompts › prm_01HQX84… › Stories › story_42 › Tasks › task_99
[link] [link]   [link]         [link]    [link]    [link]   [text]
```

### Self-hiding

- Hidden on section landings (`/work`, `/pipeline`, `/catalog`,
  `/quality`, `/operations`, `/settings`).
- Hidden on the root (`/` redirects).
- Shown on every page that is at least 2 segments deep (after redirects).

---

## 6. Conventions

- **Detail pages live at `/<resource>s/[id]`** (collection plural + id).
- **No leading verbs** in URLs.
- **Filters in query string**, never in path.
- **One canonical URL per resource.** Aliases are redirects, not parallel
  routes.
- **Section landings render an overview**, not a redirect. Where there's
  no useful overview yet, render a 6-card grid linking to children
  (cheap to build, useful as a TOC).
