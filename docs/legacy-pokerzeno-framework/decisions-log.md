# Decisions Log

Running journal of significant decisions made for the PokerZeno framework. Each entry records the date, what was decided, and why. See the ADRs directory for the full context on major architectural choices.

---

## 2026-04-01 — Frontend Framework: Next.js 15 Static Export

**Decision**: Use Next.js 15 with `output: 'export'` for all sites.

**Why**: Cloudflare Pages free tier requires static files — no Node.js server process. Card game community sites are content-heavy: tips, guides, rules, strategy articles. Dynamic data needs (leaderboards, user scores) are handled via client-side Supabase calls, not server rendering. Static export means zero server cost and sub-50ms TTFB from Cloudflare edge.

**Ref**: ADR-001

---

## 2026-04-05 — Monorepo Tooling: pnpm workspaces + Turborepo

**Decision**: Use pnpm workspaces for the plugins monorepo, with Turborepo for task orchestration.

**Why**: Nx is the heavier enterprise option — it solves problems we don't have yet (code generation scaffolding, distributed CI). Turborepo is lighter, has better default caching for small teams, and the config is a single `turbo.json` file rather than a DSL. pnpm's `workspace:*` protocol and hardlink-based `node_modules` keep installs fast and disk usage low. We evaluated this against a flat multi-repo approach and the DX difference is decisive once you need to change a type across 3 packages simultaneously.

**Ref**: ADR-009

---

## 2026-04-10 — Database: Supabase over custom Postgres

**Decision**: Use Supabase (managed PostgreSQL + Row Level Security + Auth + Edge Functions).

**Why**: The alternative was self-hosting Postgres on the same server as the app. That works fine for one site but requires backup strategy, connection pooling setup, and SSH access for schema migrations — operational overhead that scales poorly to 20+ sites. Supabase's free tier is generous (500MB database, 2GB bandwidth per project). The TypeScript client (`@supabase/supabase-js`) is well-maintained and supports RLS transparently. We wrap it in `@pokerzeno/backend-core` so sites never import it directly, which means we can swap the underlying client later without touching site code.

**Ref**: ADR-003

---

## 2026-04-15 — Hosting: Cloudflare Pages over Vercel

**Decision**: Host all sites on Cloudflare Pages.

**Why**: Vercel's pricing model works well for a single high-traffic site but becomes expensive at 20-150 sites (each project counts separately toward team limits). Cloudflare Pages is genuinely free for unlimited sites with unlimited bandwidth — the pricing change in 2024 did not affect static site hosting. The `_headers` file gives us full control over security headers (CSP, HSTS, Permissions-Policy) without any plugin. HTTP/3, global Anycast CDN, and automatic HTTPS come standard. We evaluated Netlify — same pricing concern as Vercel at scale.

**Ref**: ADR-002

---

## 2026-04-20 — Package Registry: GitHub Packages for private packages

**Decision**: Publish `@pokerzeno/*` packages to GitHub Packages (not npm).

**Why**: Private packages on npm require a paid plan. GitHub Packages is free for private packages within a GitHub org/user account. Authentication is via `GITHUB_TOKEN` or a PAT — the same credential already used for CI. The only trade-off is that consumers need to add a `.npmrc` pointing `@pokerzeno:registry` to `https://npm.pkg.github.com`. This is a one-time setup per developer machine, and it's automated in `scripts/install-hooks.sh` via an `npm config set` call.

---

## 2026-04-20 — Repository Structure: Monorepo for all plugins

**Decision**: Consolidate all `@pokerzeno/*` packages into a single `pokerzeno-plugins` monorepo.

**Why**: We had 6 packages in separate repos. The symptom that forced this decision: a type change in `@pokerzeno/types` required opening PRs in `backend-core`, `analytics`, and `ui` sequentially, waiting for CI on each before the next could start. Version drift was a real problem — `roulettecommunity` was 2 minor versions behind `pokerzeno` on `@pokerzeno/ui` because updating required a separate PR cycle. Monorepo eliminates the coordination overhead. `workspace:*` means every site always gets the latest local version during development. Changesets handles versioned releases for production.

**Ref**: ADR-009

---

## 2026-04-20 — Testing Stack: Vitest + Playwright + integrity-check

**Decision**: Three-layer test stack: Vitest for unit/component, Playwright for E2E/a11y smoke, `@pokerzeno/integrity-check` for static file validation.

**Why**: Jest was the obvious default but Vitest is measurably faster for TypeScript-heavy codebases (no babel transform step). Playwright is the current standard for E2E — better auto-waiting than Cypress, supports accessibility assertions via `axe-core` integration. The third layer (`integrity-check`) is unique to our setup: it runs on the `out/` directory after build and validates that every page has a skip-to-content link, a main landmark, and correct `lang` attribute. This catches errors that neither unit tests nor runtime E2E would catch (e.g., a layout change that removes the skip link from a specific page template).

**Ref**: ADR-006
