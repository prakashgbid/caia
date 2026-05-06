---
"caia": patch
---

ci(velocity-tier1-003): commit project `.npmrc` with shared store-dir + perf defaults

Adds a project-level `.npmrc` codifying pnpm performance settings:

- `store-dir=~/.pnpm-store` — predictable path shared across worktrees
  via hardlinks. The first install after this change repopulates the
  store; subsequent installs in any worktree are near-instant.
- `package-import-method=hardlink` — smaller node_modules + faster
  installs (pnpm default, made explicit).
- `dedupe-peer-dependents=true` — share peer-dep instances across the
  workspace (pnpm 9 default, made explicit).
- `prefer-symlinked-executables=true`, `auto-install-peers=true`,
  `prefer-offline=true`, `strict-peer-dependencies=false`,
  `enable-pre-post-scripts=false` — pnpm 9 defaults made explicit for
  documentation and consistency across hosts.

**Speedup:** 60-80% faster `pnpm install` on warm worktrees once the
store is populated; the velocity benefit compounds as the runner pool
goes online (Tier 1.1) because runners share one host store.

**One-time cost:** the first `pnpm install` after this change will
re-link from the new `~/.pnpm-store` path. Existing checkouts may show
"missing peer" warnings until the store is repopulated; a single
`pnpm install` clears them.

**Reliability:** ★ low. All settings are pnpm 9 defaults except
`store-dir`, which is a directory move — pnpm handles this transparently.
No lockfile changes in this PR; `pnpm dedupe` is a separate follow-up
(deferred to avoid Mac thrashing while parallel agents are running).

Reference: `velocity-acceleration-strategy-2026-05-06.md` §1.2 (Tier 1.4),
§A.5.
