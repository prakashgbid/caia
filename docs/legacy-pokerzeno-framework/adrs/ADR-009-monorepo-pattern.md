# ADR-009: Monorepo Pattern for Shared Packages

**Date**: 2026-04-20
**Status**: Accepted
**Deciders**: Prakash (solo founder)

---

## Context

The PokerZeno ecosystem has 9 shared packages:
- `@pokerzeno/analytics` — GA4 wrapper + consent gate
- `@pokerzeno/backend-core` — Supabase client wrapper + typed queries
- `@pokerzeno/ui` — shared React component library (Button, Card, ConsentBanner, NavBar, etc.)
- `@pokerzeno/integrity-check` — static build validator
- `@pokerzeno/content-engine` — content seeding CLI
- `@pokerzeno/types` — shared TypeScript types
- `@pokerzeno/hooks` — shared React hooks (useConsent, useLeaderboard, etc.)
- `@pokerzeno/seo` — meta/og tag helpers
- `@pokerzeno/test-utils` — shared Vitest/Playwright utilities

Previously these were 9 separate GitHub repos. Pain points:
- A type change in `@pokerzeno/types` required PRs in `backend-core`, `ui`, and `hooks` — all sequential, each waiting for CI
- `roulettecommunity` was 2 minor versions behind `pokerzeno` on `@pokerzeno/ui` — updating required a separate PR cycle with manual testing
- `package.json` in each site had diverging version pins across the same package

---

## Decision

**pnpm workspaces monorepo** (`pokerzeno-plugins` repo) with **Turborepo** for task orchestration.

### Repository Structure

```
pokerzeno-plugins/
├── pnpm-workspace.yaml
├── turbo.json
├── package.json          # root — dev dependencies, scripts
├── packages/
│   ├── analytics/        # @pokerzeno/analytics
│   ├── backend-core/     # @pokerzeno/backend-core
│   ├── ui/               # @pokerzeno/ui
│   ├── integrity-check/  # @pokerzeno/integrity-check
│   ├── content-engine/   # @pokerzeno/content-engine
│   ├── types/            # @pokerzeno/types
│   ├── hooks/            # @pokerzeno/hooks
│   ├── seo/              # @pokerzeno/seo
│   └── test-utils/       # @pokerzeno/test-utils
└── .changeset/           # changesets for versioned releases
```

### Key Configuration

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
```

`turbo.json`:
```json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {}
  }
}
```

Intra-repo dependencies use `workspace:*`:
```json
// packages/backend-core/package.json
"dependencies": {
  "@pokerzeno/types": "workspace:*"
}
```

Publishing to GitHub Packages:
```json
// packages/analytics/package.json
"publishConfig": {
  "registry": "https://npm.pkg.github.com",
  "access": "restricted"
}
```

### Versioning

`changesets` manages versioned releases:
```bash
pnpm changeset          # describe what changed
pnpm changeset version  # bump versions in package.json
pnpm changeset publish  # publish to GitHub Packages
```

---

## Consequences

**Positive**:
- `pnpm install` at the root installs all packages with shared `node_modules` via hardlinks — fast and disk-efficient
- `turbo run build` builds in correct dependency order automatically (`^build` in `dependsOn`)
- Cross-package changes land in a single commit/PR — no sequential PR chains
- `workspace:*` means local development always uses the latest code, not a stale published version

**Negative / Trade-offs**:
- Publishing requires `changesets` discipline — need to remember to create a changeset for each meaningful change
- Consumer sites must configure `.npmrc` to authenticate with GitHub Packages for `@pokerzeno/*` packages
- If `pnpm-workspace.yaml` doesn't include a package directory, `workspace:*` resolution silently fails and falls back to npm registry lookup. Always verify the workspace config when adding a new package (see L-04)

---

## Alternatives Considered

**Nx** — rejected. Nx provides code generation, distributed CI task execution, and a plugin ecosystem. These are valuable in a large team. For a solo founder with 9 packages, the configuration overhead of `nx.json`, project configuration files, and the Nx mental model is disproportionate. Turborepo achieves 90% of what we need with a single `turbo.json`.

**Lerna** — rejected. Lerna was the original monorepo tool but has had maintenance inconsistencies. Turborepo + pnpm workspaces + changesets is the modern equivalent and better supported.

**Separate repos (status quo)** — rejected. The problem statement above describes the pain directly. The version drift issue is not hypothetical — it already happened with `roulettecommunity`.

**npm workspaces + Turborepo** — considered. npm workspaces work but pnpm's hardlink-based node_modules is significantly more disk-efficient (important when developing locally with 9 packages each having their own dependencies). pnpm also has stricter phantom dependency prevention.
