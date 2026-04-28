# @chiefaia/dev-inspector — CHANGELOG

## 0.2.0 — 2026-04-28

**Breaking:** package renamed `@pokerzeno/dev-inspector` → `@chiefaia/dev-inspector` as part
of the CAIA monorepo consolidation (Track 3 of `consolidation_action_list_2026-04-28.md`).

**Breaking:** the inspector implementation was replaced.

The previous v0.1.0 was a *hover-overlay element inspector*: hover any DOM element to
see a red outline + stable component-fiber ID badge, click the badge to copy the ID
to the clipboard. Toggle with `Alt+I`. Designed to give AI orchestrators a stable
addressing scheme for any component on the page.

The new v0.2.0 is a *tabbed inspector panel* (`Cmd+Shift+I` to toggle) with five tabs:
**Accessibility** (live axe-core scan), **Integrity** (placeholder, will integrate
`@chiefaia/integrity-check`), **Console** (intercepted log entries), **Network** (fetch /
XHR timeline), **Performance** (Core Web Vitals: LCP, INP, CLS via `web-vitals`). Includes
draggable + resizable panel, MCP bridge for AI orchestrators (`startBridge`/`stopBridge`),
and dev-only code path (tree-shaken when `NODE_ENV !== 'development'`).

The newer implementation was developed against `pokerzeno` and `roulette-community` while
the old version sat unused in CAIA. We chose **vendor wins** because:
1. Both production sites already run the tabbed version (vendored under `vendor/dev-inspector`).
2. The tabbed version covers a strict superset of debugging needs (a11y, perf, network all on
   one panel) versus the old fiber-id hover scheme.
3. Keeping the old code as a stale CAIA package would diverge two implementations forever.

The previous overlay implementation is preserved for reference under `legacy/` — it is not
compiled, not exported, and excluded from `tsconfig.build.json`. If we ever want the
hover-fiber-ID behavior back, port from there.

**New peer dependencies (optional):** `axe-core` (used by the Accessibility tab via dynamic
import) and `web-vitals` (used by the Performance tab). Both are declared
`peerDependenciesMeta.optional = true` so consumers without those installed will fail-soft on
the affected tabs only.

## 0.1.0 — earlier (legacy/)

Hover-overlay element inspector. See `legacy/README.md` history. Source archived under
`legacy/` for reference; not part of the build.
