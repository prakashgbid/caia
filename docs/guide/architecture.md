# Architecture

## Monorepo Layout

```
caia/
├── packages/          @chiefaia/* packages live here
│   ├── logger/
│   ├── events/
│   ├── metrics/
│   ├── tracing/
│   ├── errors/
│   ├── config/
│   ├── secrets/
│   ├── test-kit/
│   └── cli/
├── configs/           Shared tooling configs
│   ├── eslint-config/
│   ├── tsconfig/
│   └── vitest-config/
├── templates/
│   ├── utility/       Used by `caia new utility`
│   └── site/          Used by `caia new site` (produces outside-monorepo repos)
└── docs/              This site
```

## Dependency Graph

Packages depend only on packages in the same or lower tier:

```
test-kit → logger, events, secrets
config   → errors
secrets  → (no CAIA deps)
errors   → (no CAIA deps)
logger   → (no CAIA deps)
events   → (no CAIA deps)
metrics  → (no CAIA deps)
tracing  → (no CAIA deps)
cli      → (no CAIA package deps)
```

## Tier-5 Sites

Site repos are **outside** the monorepo. `caia new site` clones `templates/site/` into a sibling directory. Sites consume `@chiefaia/*` packages as npm dependencies pinned to specific versions.

```
caia/              ← this repo
../my-site/        ← Tier-5 site repo (separate git repo)
../other-site/     ← another Tier-5 site
```
