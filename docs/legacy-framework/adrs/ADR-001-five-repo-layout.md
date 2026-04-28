# ADR-001 — Five-Repo Layout

**Status**: Accepted  
**Date**: 2026-04-20  
**Deciders**: Prakash (solo founder)

---

## Context

The PokerZeno platform targets multiple gambling-adjacent niches (poker, roulette, and future games). Each niche needs its own domain, brand, and SEO identity. However, all sites share the same technical stack, component library, content pipeline, and CI/CD patterns.

Two extremes were considered:

- **Monorepo**: All sites in one repo. Simple tooling, but Git history mixes concerns and deploying one site risks another.
- **Fully isolated repos**: Each site is standalone. Clean separation, but shared code drifts apart and maintenance multiplies.

The chosen middle ground is a **five-repo layout** — a small federation of repos with clear responsibilities.

---

## Decision

The platform is split into five repositories:

| Repo | Purpose |
|------|---------|
| `framework` | Cross-project ADRs, lock files, scaffold script, CI templates — this repo |
| `plugins` (monorepo) | Shared packages: `@pokerzeno/backend-core`, `@pokerzeno/content-engine`, `@pokerzeno/integrity-check`, `@pokerzeno/image-provider`, `@pokerzeno/analytics`, `@pokerzeno/cast-bridge`, `@pokerzeno/seo-program`, `@pokerzeno/dev-inspector` |
| `site-template` | Canonical Next.js 14 starter with `{{SITE_NAME}}`, `{{DOMAIN}}`, `{{SLUG}}` placeholders — cloned by `bin/new-site.sh` |
| `poker-zeno` | Live site: pokerzenith.com — poker strategy and tools |
| `roulette-community` | Live site: roulettecommunity.com — roulette strategy and community |

Future sites (blackjack, slots, etc.) follow the same pattern: clone `site-template`, add an entry here.

---

## Rationale

- **Separation of deploy risk**: A broken change in `roulette-community` cannot affect `poker-zeno`'s production deploy.
- **Shared code via packages**: `plugins` monorepo publishes versioned packages. Sites pin to a version; upgrades are explicit.
- **Single scaffold path**: `bin/new-site.sh` clones `site-template` and substitutes placeholders. No copy-paste drift.
- **Lock files in framework**: Accessibility, brand, domains, and behavior-testing locks live here — not scattered in each site.
- **Manageable CI**: Each repo has its own CI pipeline; they share templates from `framework/config/ci/`.

---

## Consequences

- Adding a new site takes ~15 minutes (run `new-site.sh`, configure domain, push).
- Breaking changes to `plugins` packages require a version bump and coordinated upgrade across all sites.
- `framework` ADRs must be updated when architectural decisions change — not optional.
- The `site-template` must stay generic; brand-specific code belongs in site repos only.

---

## Alternatives Rejected

| Alternative | Reason Rejected |
|-------------|----------------|
| Monorepo (all sites) | Shared deploy risk; Git noise across unrelated sites |
| Fully isolated (no shared packages) | Code drift; maintenance burden grows with each new site |
| Submodule approach | Git submodules are fragile and complicate local development |
