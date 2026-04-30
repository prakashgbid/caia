# Dashboard UI conventions

> **Status:** active. Companion to `dashboard-url-schema.md`.
>
> Covers nav structure, breadcrumb spec, drill-down navigation pattern,
> agent-activity widget spec, prompt-from-anywhere pattern, page templates.

---

## 1. Left-nav structure

Six accordion sections in `apps/dashboard/components/nav/Sidebar.tsx`.
Section data lives in `apps/dashboard/components/nav/groups.ts`
(`NAV_GROUPS`).

| Section | Icon | Default state |
|---|---|---|
| Work | 📋 | expanded |
| Pipeline | 🔀 | expanded |
| Catalog | 📚 | collapsed |
| Quality | ✅ | collapsed |
| Operations | 🛠️ | collapsed |
| Settings | ⚙️ | collapsed |

Multi-open accordion. Per-group expanded state persists in `localStorage`
under `nav.expanded`. Per-leaf badges (`useUnseenBadges`) roll up to
section headers when collapsed.

---

## 2. Breadcrumb component

File: `apps/dashboard/components/Breadcrumb.tsx`.

Self-derives from `usePathname()`. No props. Wired into `app/layout.tsx`
so every page gets it.

Self-hiding rules:
- Hidden on section landings.
- Hidden on `/`.
- Shown on every drill-down ≥ 2 segments deep.

A11y:
- `<nav aria-label="Breadcrumb">`.
- Last crumb has `aria-current="page"`.
- Separators (`›`) are `aria-hidden`.

---

## 3. Drill-down navigation pattern

> **Rule:** any row representing a resource (prompt, story, task, stage,
> blocker, build, agent, requirement) navigates to its detail page on
> click.

### Implementation

- List rows are `<Link>` anchors (so cmd-click / middle-click open in new
  tab) covering the whole row.
- Detail pages render a parent-child lineage panel above the main content:

  ```
  Lineage: Initiative ▸ Epic ▸ Module ▸ THIS
  Children: 3 stories, 12 tasks
  ```

- Below the main content, an `EventTimeline` section pulls
  `GET /events?<scope>=<id>` and live-updates over the WS feed.

### Detail-page template

```tsx
<>
  <Breadcrumb />
  <h1>{title}</h1>
  <LineagePanel parents={…} childrenSummary={…} />
  <DetailContent />
  <EventTimeline filter={…} />
</>
```

---

## 4. Agent-activity widget (DASH-005)

Persistent right-sidebar at `apps/dashboard/components/agents/AgentActivityRail.tsx`.
Hook: `apps/dashboard/hooks/useAgentActivity.ts`. Mounted in
`app/layout.tsx` next to `<main>`.

### Placement

- Default: 280px right rail, full height, scrollable.
- Collapsed: 40px rail with vertical text count of busy agents.
- Collapsed state persists in `localStorage` under `agent-rail.collapsed`.

### Data flow

1. Hook fetches `${API}/agents` at mount for the seed roster (non-fatal
   on failure).
2. Hook subscribes to the existing `useWebSocket('ws://localhost:7776/events')`
   feed and updates per-agent state on `task_run.*`, `task.*`,
   `agent.*`, and `pipeline.*` events.
3. Derived fields computed client-side:
   - `time-in-stage` (uses `stageStartedAt`).
   - `status` ∈ {`idle`, `busy`, `error`}.
   - `todayCompleted`, `errors7d`.
   - `recentLogs[]` (last 5 lines).

No new backend code is added. If `/agents/active` ships later, the hook
will prefer it (single round-trip).

### Per-agent card

```
🤖 product-owner             [busy 3m]
   ▸ task task_xy
   stage: po-recursive-decompose
   Today: 12 • Errors 7d: 0
   > step 4/6: emitting child stories…
```

- Header click → `/catalog/agents/<agentId>`.
- Task link → `/work/tasks/<taskId>`.
- Stage link → `/work/prompts/<promptId>/pipeline/<stageId>`.

### Sort order

1. Errored agents pinned with red border.
2. Busy agents sorted by stage-start-time (oldest at top).
3. Idle agents alphabetical.

### Live "thoughts" ticker

Below the per-agent list, last 4 log lines from any agent (filtered to
events with a `message` or `payload.text` field).

### Backlog item

If `/agents/active` becomes available, the hook switches to it. Until
then, derive from the WS feed.

---

## 5. Prompt-from-anywhere pattern (DASH-011)

> Submit a prompt from anywhere in the dashboard, with full context
> auto-attached. The CAIA pipeline (PO → BA → EA → …) processes the
> prompt; `metadata.context` is consumed by PO's scope-detector as a hint.

### UI surfaces

1. **Floating prompt button** — bottom-right corner of every page.
   Clicking opens a modal with a textarea + scope/run-mode selector.
2. **Inline `+` icons on rows** — every prompt/story/task row in any
   list gets a small `+` that opens the modal pre-populated with that
   row's context.
3. **Text-selection prompts** — highlighting any text on the dashboard
   shows a "Ask CAIA about this →" tooltip; clicking opens the modal
   pre-populated with the selected text + page context.
4. **Keyboard shortcut** — `Cmd+K` (or `Ctrl+K`) opens the modal from
   anywhere.
5. **Prompt history quick-access** — the modal shows the user's last 5
   submitted prompts as quick-restart options.

### Auto-context payload

Every prompt submission packs context into `metadata.context`:

```json
{
  "text": "<the prompt>",
  "run_mode": "plan-only" | "test-only" | "full",
  "metadata": {
    "context": {
      "currentRoute": "/work/prompts/prm_xyz/stories/story_abc",
      "breadcrumb": ["Work", "Prompts", "prm_xyz", "Story story_abc"],
      "scope_hint": {
        "projectSlug": "<from URL if any>",
        "promptId": "<parent prompt if drilling down>",
        "storyId": "<parent story if drilling down>",
        "taskId": "<parent task if drilling down>",
        "agentId": "<parent agent if on agent page>"
      },
      "submittedFrom": "<page name>",
      "filterState": { "<filter>": "<value>" }
    }
  }
}
```

### Backend constraint

Still UI-only. The existing `POST /prompts` endpoint accepts
`metadata`; if not yet first-class, the dashboard sends it anyway and
the backend ignores extra fields. **Backlog item:** make
`metadata.context` first-class for PO Agent's scope-detector.

### Files

- `apps/dashboard/components/prompt/FloatingPromptButton.tsx`
- `apps/dashboard/components/prompt/PromptModal.tsx`
- `apps/dashboard/hooks/usePromptContext.ts` — derives context from
  pathname + filter state.
- Tests: `apps/dashboard/tests/prompt-from-anywhere.spec.ts` (Playwright,
  3 page types: home, prompt detail, story detail).

---

## 6. Page templates

### 6a. Section landing

```tsx
<>
  <h1>{section.title}</h1>
  <KpiRow stats={…} />
  <SectionGrid items={children} />
  <RecentActivity filter={section} />
</>
```

### 6b. List view

```tsx
<>
  <Breadcrumb />
  <h1>{title}</h1>
  <FilterBar filters={…} />
  <SortBar sort={…} />
  <ResultsTable rows={…} />
  <Pagination />
</>
```

### 6c. Detail view

See §3.

---

## 7. Visual style

- Backgrounds: `#0f1117` body, `#1a1f2e` sidebar, `#2d3748` borders.
- Cards: 12px radius, `#1a1f2e` background, `#2d3748` border, 16px padding.
- Hover: `#2d3748` background.

The redesign is IA-only — no theming changes.

---

## 8. Accessibility

- Every row link has a descriptive `aria-label`.
- Breadcrumb has `aria-label="Breadcrumb"` and the current crumb has
  `aria-current="page"`.
- Agent-activity rail has `aria-label="Agent activity"`.
- Section accordions are `<button aria-expanded>` + `<ul role="region">`.

Pre-existing axe failures are not regressed; new components pass axe.

---

## 9. Visual regression

Layout changes (new nav, breadcrumb, agent rail, floating prompt button)
break Playwright visual baselines. Each PR that intentionally changes
layout runs:

```
pnpm visual:update
git add apps/dashboard/__visual_baselines__
git commit
```

Baselines are committed in the same PR as the layout change.

---

## 10. Backward compatibility

- All old top-level URLs continue to work via Next.js redirects (PR2).
- The `?project=<slug>` query convention is preserved.
- The `useWebSocket('ws://localhost:7776/events')` subscription is
  unchanged.
- The `useUnseenBadges` hook is unchanged; new section headers compute
  their own roll-up.
