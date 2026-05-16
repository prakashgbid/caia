---
name: caia-website-tech-architecture
created: 2026-05-16T09:05:00Z
updated: 2026-05-16T09:05:00Z
status: design
type: design
chain: caia-website-tech-arch-auth / phase 1 of 1
spawn_id: phase1-20260516T090352-66547
scope: caia repository (~/caia) — public-facing website + auth bridge
adr_refs: []
---

# CAIA Public-Facing Website — Technical Architecture

**Phase 1 of 1 design.** Implementation chains scaffold from this doc; no code is written here.

The operator's read: the CAIA platform now needs a public surface — a marketing/research site that ends in a "Login" button which lands a credentialed user on the CAIA dashboard (today running at `:7777`). The design covers stack, deployment, content, auth, CI, reuse, and a decision matrix.

---

## 0. Constraints anchored to existing reality

Before any choice is made, the constraints already in the repo decide most of the answers:

| # | Constraint (source) | Decision impact |
|---|---|---|
| C1 | `apps/dashboard` is Next.js **15.5.15** + React **19** on port **7777** (`apps/dashboard/package.json`). | The website should match — same Next major + React major — so we can share packages and types. |
| C2 | Dashboard uses **App Router**, **`'use client'` everywhere**, **SWR**, **`@ai-sdk/react`**, **vitest + playwright + LHCI** (`apps/dashboard/package.json`). | The website inherits this exact toolchain to keep CI predictable. |
| C3 | Dashboard has **no auth** today — operator-only perimeter trust (`reports/audits/2026-05-16-caia-dashboard-codebase-audit.md` §3.1). | We **introduce** auth at the website boundary; the dashboard becomes auth-required behind an ingress. This is a one-way migration — design must include the safe-rollback path. |
| C4 | Repo is a **pnpm workspace** with `@chiefaia/*` private packages, **strict TS**, **ESM-only**, **Node ≥20**, **6-check Evidence Gate** (`AGENTS.md`). | The website is a workspace package, not a separate repo. |
| C5 | Existing **site template** at `caia/templates/site/` uses **Tailwind + Next 15 + React 19** with PokerZeno brand placeholder. | Tailwind is the canonical site styling system in this org; we reuse it for the new website (not the dashboard's inline-CSS approach). |
| C6 | Git Flow is **enforced** — `feature → develop → release → main`, branch-protected (`docs/git-flow.md`). | The website's CI must match: no direct main push, six evidence-gate checks, changeset required. |
| C7 | Stolution k3s uses **ArgoCD GitOps** with **GHCR images**, namespaces `stolution-{prod,staging,ai,data,security}`, **self-hosted runners** (`stolution/.github/workflows/deploy-production.yml`, `stolution/infrastructure/k8s/exports/*.yaml`). | The k3s deployment story for the website matches stolution-web's existing pattern. |
| C8 | Audit found the dashboard's **client paths**, **broken stub routes**, and the **orchestrator-on-:7776 data plane**. (`reports/audits/2026-05-16-caia-dashboard-codebase-audit.md` §6) | The website **must not** add load to the orchestrator; its data plane is its own (static MDX + a thin login endpoint). |

Everything below flows from C1–C8.

---

## 1. Tech stack recommendation

### 1.1 The pick

**Next.js 15.5.15 (App Router) + React 19 + TypeScript strict + Tailwind 3.4 + MDX**, packaged as `caia/apps/website` in the existing pnpm monorepo under the `@caia-app/website` package name.

### 1.2 Justification

- **Symmetry with the dashboard (C1, C2).** Same React major means components can be moved across the boundary unchanged. Same Next major means the same `next/image`, `next/link`, `next/headers`, and `middleware` APIs apply. Same node major (≥20) means one Docker base image.
- **Symmetry with the existing site template (C5).** `caia/templates/site/package.json` already lists exactly this stack (`next@15.5.15`, `react@^19`, `tailwindcss@^3.4`, `lucide-react`). We are not picking new technology — we are instantiating the existing template.
- **MDX for content (C8).** The site's job is technical/research storytelling about the platform; MDX in repo gives us code blocks, math, callouts, and frontmatter-typed page metadata, all under git review without a CMS dependency.
- **Pnpm workspace member (C4).** Living in `apps/website` means:
  - Free access to every `@chiefaia/*` package (analytics, dev-inspector, logger, hmac-auth, secrets-broker, etc.).
  - The Evidence Gate runs across the website automatically.
  - Changesets, turbo cache, ESLint config, Playwright config, Vitest config — all inherited.

### 1.3 Alternatives considered (and rejected)

| Alternative | Why rejected |
|---|---|
| **Separate repo** (`caia-website`) | Loses workspace package access, doubles CI maintenance, splits design-token authority. Only acceptable if open-sourcing the website to public contributors, which is not the goal. |
| **Astro** | Excellent for static-heavy sites, but the auth flow needs runtime route handlers; mixing Astro + Next adds toolchain mass for marginal benefit. |
| **Vite + React Router** | No SSR/SSG, no `app/` router, no Vercel/k3s SSR story. Would lose SEO for marketing pages. |
| **Docusaurus / VitePress** | The repo already abandons VitePress (`docs/.vitepress` is being retired per `docs/website-design-system/`). Avoid resurrecting it. |
| **Remix v2** | Excellent framework, but second-source — splits team mind-share and toolchain from the dashboard. |

### 1.4 Package shape

```
caia/apps/website/
  app/
    layout.tsx              # Shared header/footer/Tailwind base
    page.tsx                # Home (marketing hero)
    (marketing)/
      product/page.mdx
      research/page.mdx
      pricing/page.mdx
      changelog/page.mdx
    (auth)/
      login/page.tsx        # GitHub OAuth entry
      callback/route.ts     # OAuth callback
      logout/route.ts
    api/
      auth/[...auth]/route.ts # Auth.js v5 handler
      health/route.ts
  components/
    Header.tsx
    Footer.tsx
    LoginButton.tsx
    Hero.tsx
  content/                  # Optional — MDX for /research/* deep posts
  lib/
    auth.ts                 # Auth.js v5 config
    session.ts              # JWT verify helper (server-only)
  middleware.ts             # Edge guard for /dashboard handoff
  tailwind.config.ts
  next.config.mjs
  package.json              # @caia-app/website, port 7778
```

Port allocation: dashboard owns `7777`, website takes `7778`. Both register in `docs/operator/DEV-PORTS-STANDARD.md` (carried over from `stolution/DEV-PORTS-STANDARD.md`).

---

## 2. Deployment target

### 2.1 The pick

**Primary: self-hosted on the stolution k3s cluster (`stolution-prod` namespace), built as a GHCR image, deployed via ArgoCD GitOps — matching the existing stolution-web pattern.** Preview deployments use **Vercel** for PRs only (no production traffic on Vercel).

### 2.2 Why k3s primary, not Vercel

- **Auth control (C3).** We are introducing the platform's first credentialed surface. Issuing httpOnly cookies that bridge into the dashboard requires both apps share a parent domain (e.g. `caia.dev` and `app.caia.dev`) and TLS terminator. K3s with the existing NGINX ingress and cert-manager already does this for stolution-web; reusing it is cheaper than a new Vercel + Vercel-edge cookie story.
- **Existing infra (C7).** `stolution/infrastructure/k8s/exports/stolution-prod-deployments.yaml` already shows the pattern: GHCR image → kubectl apply → ArgoCD sync. We add one more Deployment + Service + Ingress; this is hours, not days.
- **No cold-start.** Marketing pages must be fast; k3s gives us long-lived pods with the warm Next.js worker.
- **Cost predictability.** Vercel charges per build-minute and per edge-function execution; once we add OAuth callbacks and middleware checks, the cost trajectory diverges. K3s on our own hardware is flat.
- **Sovereignty.** OAuth callbacks land on infrastructure we control; no third-party platform sees the bridge token.

### 2.3 Why Vercel for previews only

PR-preview ergonomics on Vercel are unmatched (commit-SHA URL, automatic comment on PR). We exploit this for marketing-page review without granting Vercel production traffic. Preview deploys do **not** receive the production OAuth client_id; they get a `dev-only-noop` provider that fakes a session, gated behind `NEXT_PUBLIC_ENV=preview`.

### 2.4 K3s deployment shape

```yaml
# infra/stolution/k8s/website-deployment.yaml (new file)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: caia-website
  namespace: stolution-prod
spec:
  replicas: 2
  selector: { matchLabels: { app: caia-website } }
  template:
    metadata: { labels: { app: caia-website } }
    spec:
      containers:
      - name: caia-website
        image: ghcr.io/prakashgbid/caia-website:${SHA}
        ports: [{ containerPort: 3000 }]
        env:
        - { name: NODE_ENV, value: production }
        - { name: NEXT_PUBLIC_DASHBOARD_URL, value: https://app.caia.dev }
        - name: AUTH_SECRET
          valueFrom: { secretKeyRef: { name: caia-website-secrets, key: auth-secret } }
        - name: GITHUB_CLIENT_ID
          valueFrom: { secretKeyRef: { name: caia-website-secrets, key: github-client-id } }
        - name: GITHUB_CLIENT_SECRET
          valueFrom: { secretKeyRef: { name: caia-website-secrets, key: github-client-secret } }
        resources:
          requests: { cpu: 100m, memory: 256Mi }
          limits:   { cpu: 500m, memory: 512Mi }
        readinessProbe: { httpGet: { path: /api/health, port: 3000 }, initialDelaySeconds: 5 }
        livenessProbe:  { httpGet: { path: /api/health, port: 3000 }, periodSeconds: 30 }
```

Ingress mounts `caia.dev` → website Service, `app.caia.dev` → dashboard Service (a parallel Deployment to be authored in a sibling chain).

### 2.5 Cloudflare Pages — considered, rejected

Cloudflare Pages is great for static, but our login flow needs **server-side OAuth callback handling with persistent secrets**. Pages Functions can do this, but it splits the codebase across "static" and "Workers"; the cognitive tax does not pay back.

---

## 3. Content strategy

### 3.1 The pick

**Static MDX in repo for all evergreen content; a thin set of dynamic pages for login, account, and dashboard handoff; a git-history-driven changelog page; no headless CMS.**

### 3.2 What lives where

| Surface | Storage | Update cadence | Reviewer |
|---|---|---|---|
| `/` home, `/product`, `/pricing` | MDX in `apps/website/app/(marketing)/*.mdx` | Weeks to months | PR review, normal Git Flow |
| `/research/<slug>` deep posts | MDX in `apps/website/content/research/*.mdx` with typed frontmatter | Episodic | PR review, plus a `docs/website/research-style-guide.md` reviewer checklist |
| `/changelog` | Auto-generated from `.changeset/*.md` already present in the monorepo | On every release | None — derived |
| `/login`, `/account`, `/dashboard-redirect` | Dynamic route handlers (server components + RSC) | Code-level | Normal PR review |

Frontmatter contract (typed via `zod`):

```ts
const ResearchFrontmatter = z.object({
  title: z.string().max(120),
  description: z.string().max(280),
  date: z.string().date(),
  author: z.enum(['operator', 'caia']),     // platform-or-human attribution
  tags: z.array(z.string()).max(8),
  draft: z.boolean().default(false),
  superseded_by: z.string().optional(),     // slug, supports the report-vs-living-doc split
});
```

### 3.3 Why MDX, not a headless CMS

- **Single audience: the operator.** No need for a marketing team's GUI.
- **Code-block fidelity.** The content is technical — examples are pnpm commands, snippets, ADR refs. MDX renders them at build time with `shiki` syntax highlighting; CMSs ship plain `<pre>`.
- **PR-reviewable.** Content changes go through the same Evidence Gate as code, leaving an audit trail.
- **No runtime cost.** MDX compiles to static React; no DB query per request.

### 3.4 Why not pure markdown + a static-site-generator

We need *some* dynamic pages (login). Once Next.js is in, free MDX is one Webpack loader away. Adding a separate SSG would split the toolchain.

---

## 4. Login flow architecture

This is the load-bearing section of the design. The operator's directive is: visitor logs in on the website → lands on the dashboard at `:7777`.

### 4.1 Reconciliation: what `:7777` means in production

`:7777` is the **dev** convention. In production the dashboard is exposed under `https://app.caia.dev` via the same k3s ingress, and continues to listen on container-port `3000` (Next.js default). Local dev keeps `:7777` (operator's machine). The website's `LOGIN_TARGET` env var is set to `http://localhost:7777` in dev and `https://app.caia.dev` in prod.

### 4.2 Authentication method

**Primary: GitHub OAuth.** Justification:
- The platform is operator + internal-team-only. The operator and contributors already have GitHub accounts (the entire codebase is on GHCR + GitHub).
- No password storage burden, no password-reset flow, no breach blast-radius.
- GitHub OAuth scopes (`read:user`, `user:email`) are minimal.
- Matches `@chiefaia/hmac-auth`'s mental model: identity is something we *verify*, not something we *issue*.

**Secondary: magic-link email** (Resend + Auth.js v5 Email provider) for non-GitHub users (rare; e.g. a future board member or auditor). Not the default path.

**Explicitly rejected: passwords + 2FA.** The pass/2FA combo is the worst of both worlds for a single-operator surface — all the credential-handling responsibility, none of the integration ease.

**Authorization layer:** an **allowlist** of GitHub IDs (env-backed JSON in a k8s secret). On callback, if the GitHub user_id is not in the allowlist, return a 403 page that says "Request access" and a `mailto:` to the operator. The allowlist is the security perimeter; it can grow without re-architecting.

### 4.3 Session strategy

**Stateless JWT in an httpOnly, Secure, SameSite=Lax cookie, scoped `Domain=.caia.dev`, signed with a rotated symmetric key.**

- **Stateless** because we don't want a session store dependency and don't want to add load to the orchestrator on :7776 (C8).
- **httpOnly** so JS cannot read it (XSS defense).
- **Secure** so it never travels over plain HTTP (TLS-only ingress in prod; cookie attribute set to relaxed `Secure` in dev when localhost).
- **SameSite=Lax** so top-level navigation from the website to the dashboard carries the cookie; cross-site POSTs do not (CSRF defense).
- **`Domain=.caia.dev`** so the same cookie is valid on `caia.dev` (website) and `app.caia.dev` (dashboard) — this is what makes the bridge work without redirects-with-tokens-in-URL.

Token shape:

```ts
type CaiaSessionJWT = {
  sub: string;          // GitHub user_id, e.g. "12345"
  login: string;        // GitHub login, e.g. "prakashgbid"
  email?: string;
  role: 'operator' | 'reader';   // allowlist tier
  iat: number;          // issued
  exp: number;          // 15 min access
  jti: string;          // for revocation list (future)
};
```

Refresh: a second `__Host-caia.refresh` cookie (7 days, Path=/api/auth) lets the website silently rotate the access JWT. Refresh tokens are rotated on use.

**Key rotation:** `AUTH_SECRET` is a k8s secret; rotated every 90 days via an operator runbook (`docs/runbooks/auth-secret-rotation.md`, to be authored). JWTs older than the previous secret are rejected.

### 4.4 Bridging website → dashboard

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                       caia.dev                          │
                    │  ┌─────────────────────────────────────────────────┐    │
                    │  │ Website (Next.js, this project)                 │    │
                    │  │   - GET /  marketing page                       │    │
                    │  │   - GET /login → 302 → github.com/oauth         │    │
                    │  │   - GET /callback?code=... ← github callback    │    │
                    │  │     - exchange code → access_token              │    │
                    │  │     - fetch GitHub /user                        │    │
                    │  │     - check allowlist                           │    │
                    │  │     - mint CaiaSessionJWT                       │    │
                    │  │     - Set-Cookie: __Host-caia=...; Domain=...   │    │
                    │  │     - 302 → https://app.caia.dev/timeline       │    │
                    │  └─────────────────────────────────────────────────┘    │
                    └─────────────────────────────────────────────────────────┘
                                              │
                                              │  cookie travels (.caia.dev)
                                              ▼
                    ┌─────────────────────────────────────────────────────────┐
                    │                     app.caia.dev                        │
                    │  ┌─────────────────────────────────────────────────┐    │
                    │  │ Dashboard (Next.js, apps/dashboard)             │    │
                    │  │   - middleware.ts reads __Host-caia             │    │
                    │  │   - jwtVerify(token, AUTH_SECRET)               │    │
                    │  │   - if invalid → 302 → caia.dev/login           │    │
                    │  │   - if valid → set req.user → render            │    │
                    │  └─────────────────────────────────────────────────┘    │
                    └─────────────────────────────────────────────────────────┘
```

### 4.5 ASCII sequence diagram

```
Visitor          caia.dev                  github.com         app.caia.dev
   │                │                          │                   │
   │  GET /         │                          │                   │
   ├───────────────▶│                          │                   │
   │   200 hero     │                          │                   │
   │◀───────────────┤                          │                   │
   │                │                          │                   │
   │  click "Login" │                          │                   │
   │  GET /login    │                          │                   │
   ├───────────────▶│                          │                   │
   │  302 to github │                          │                   │
   │◀───────────────┤                          │                   │
   │  GET /authorize?client_id=...&state=S     │                   │
   ├──────────────────────────────────────────▶│                   │
   │  prompt + consent                         │                   │
   │◀──────────────────────────────────────────┤                   │
   │  302 to caia.dev/callback?code=C&state=S  │                   │
   │◀──────────────────────────────────────────┤                   │
   │                │                          │                   │
   │  GET /callback?code=C&state=S             │                   │
   ├───────────────▶│                          │                   │
   │                │   POST /oauth/token (server-to-server)       │
   │                ├─────────────────────────▶│                   │
   │                │   { access_token: A }    │                   │
   │                │◀─────────────────────────┤                   │
   │                │   GET /user  Bearer A    │                   │
   │                ├─────────────────────────▶│                   │
   │                │   { id, login, email }   │                   │
   │                │◀─────────────────────────┤                   │
   │                │   allowlist check ✓      │                   │
   │                │   mint JWT, Set-Cookie   │                   │
   │  302 to app.caia.dev/timeline             │                   │
   │  Set-Cookie: __Host-caia=...; Domain=.caia.dev                │
   │◀───────────────┤                          │                   │
   │                │                          │                   │
   │  GET /timeline   (cookie carried, Domain=.caia.dev)           │
   ├───────────────────────────────────────────────────────────────▶
   │                │                          │  middleware.ts    │
   │                │                          │  jwtVerify ✓      │
   │                │                          │  200 dashboard    │
   │◀───────────────────────────────────────────────────────────────
   │                │                          │                   │
   │  (15 min later, access expires)           │                   │
   │  GET /timeline (refresh cookie present)                       │
   ├───────────────────────────────────────────────────────────────▶
   │                │                          │  silent rotate    │
   │                │                          │  302 to /api/refresh
   │                │                          │  Set-Cookie new   │
   │                │                          │  302 back         │
```

### 4.6 Dev / local-dashboard compatibility

The operator still wants to run `pnpm dev` on `apps/dashboard` against `:7777` and hit it directly. The dashboard's `middleware.ts` therefore implements:

```ts
if (process.env.NODE_ENV === 'development' && process.env.AUTH_REQUIRED !== 'true') {
  // legacy operator-only mode, no auth check
  return NextResponse.next();
}
```

Production builds set `AUTH_REQUIRED=true`. Local dev sets it unset, so the dashboard behaves exactly as today (C3 safe rollback).

### 4.7 What is explicitly **not** in scope for phase 1 implementation

- Multi-tenant org/team modelling (today: single allowlist; future: GitHub org membership).
- SCIM/SSO for enterprise customers.
- Audit log of logins (will reuse `@chiefaia/logger` + mentor-event-bus event `auth.login.succeeded`).
- Role-based access (the JWT has a `role` field placeholder, but only one role exists initially).

---

## 5. Build + deploy pipeline

### 5.1 Environments

| Env | Branch trigger | URL | Auth | Image tag |
|---|---|---|---|---|
| **Local dev** | n/a | `http://localhost:7778` (web) + `http://localhost:7777` (dashboard) | bypassed (NODE_ENV=development) | n/a |
| **PR preview** | every PR commit | `<pr-sha>.caia-website.vercel.app` | noop provider, banner reads "PREVIEW — NO AUTH" | Vercel |
| **Staging** | merge to `develop` | `staging.caia.dev` → k3s `stolution-staging` ns | real GitHub OAuth, separate client_id, allowlist = `[operator]` | `:develop-<sha>` |
| **Production** | merge to `main` | `caia.dev` → k3s `stolution-prod` ns | real GitHub OAuth, prod client_id, allowlist | `:main-<sha>` + `:latest` |

### 5.2 CI workflow shape

A new file: `.github/workflows/website-ci.yml`. It reuses the Evidence Gate primitives already in `.github/workflows/ci.yml` (C6):

```
detect-changes (paths: apps/website/**, packages/design-tokens/**, packages/ui-primitives/**)
  └── jobs run only if those paths changed (cost discipline)
       ├── build-website        (next build, surfaces TS errors)
       ├── test-website         (vitest)
       ├── lint-website         (eslint with @caia/eslint-config)
       ├── typecheck-website    (tsc --noEmit, repo-wide)
       ├── a11y-website         (playwright + @axe-core/playwright on key routes)
       ├── lighthouse-website   (LHCI, score budget 90/95/90/100 for PWA-irrelevant)
       └── visual-website       (playwright screenshot baselines)
```

These six map directly to the dashboard's existing test surface, which means review reviewers know the rubric. Visual baselines start at three routes (`/`, `/product`, `/login`) and grow.

### 5.3 Deploy workflow (production)

A new file: `.github/workflows/website-deploy-production.yml`, modeled on `stolution/.github/workflows/deploy-production.yml`:

```
on: push to main, paths: apps/website/**, infra/stolution/k8s/website-*.yaml

jobs:
  validate (re-runs unit tests + a11y on main)
  build-image (Docker buildx, multi-arch, tag ghcr.io/.../caia-website:<sha>)
  push-image (to GHCR, authenticated via repo secret GHCR_TOKEN)
  update-manifest (sed-replace image tag in infra/stolution/k8s/website-deployment.yaml)
  argocd-sync (kubectl apply -f, or rely on ArgoCD auto-sync if configured)
  smoke (curl https://caia.dev/api/health → 200, curl /login → 302 to github)
  rollback-if-smoke-fails (kubectl rollout undo)
```

Runners: `runs-on: self-hosted` for the image build (faster local cache, GHCR push), `ubuntu-latest` for validate jobs.

### 5.4 Rollback

Three independent rollback paths, in order of preference:

1. **ArgoCD revert.** `argocd app rollback caia-website <previous-sha>` — declarative, ~30s.
2. **kubectl rollout undo.** Imperative, faster (~10s), bypasses ArgoCD.
3. **Re-tag previous GHCR image as `:latest` and bounce the Deployment.** Slowest, for break-glass.

### 5.5 Secret management

All secrets — `AUTH_SECRET`, `GITHUB_CLIENT_SECRET`, `RESEND_API_KEY` — live in k8s `Secret` objects in the `stolution-prod` namespace, **never** in `.env` files committed anywhere. Local dev uses `.env.local` (gitignored) seeded from `1Password://caia/website/dev/`. The `@chiefaia/secrets-broker` package is the canonical accessor; the website's `lib/env.ts` calls into it.

---

## 6. Reuse strategy — must reuse, must not break dashboard

The website must share visual identity and primitives with the dashboard without inheriting the dashboard's load-bearing-but-experimental layout shell.

### 6.1 New shared packages (extracted in implementation phase 2)

| Package | Owners | Contents |
|---|---|---|
| `@chiefaia/design-tokens` | website + dashboard | CSS custom properties for color (`--color-bg: #0f1117`, `--color-fg: #e2e8f0`, `--color-accent: #63b3ed`), type scale, spacing scale, radii. Emitted as both a `tokens.css` and a `tokens.ts` for typed access. |
| `@chiefaia/ui-primitives` | website + dashboard | Headless `<Button>`, `<Input>`, `<Card>`, `<Modal>`, `<Toast>`. Tailwind-class consumers on the website; inline-style consumers on the dashboard wrap them with the existing inline style helpers. |
| `@chiefaia/auth-bridge` *(new — minimal)* | website + dashboard | The shared JWT verify + cookie-name constants. Both `apps/website/lib/auth.ts` and `apps/dashboard/middleware.ts` import from here. Single source of truth for the wire format. |

### 6.2 What the dashboard imports from these

- Day 1: only `@chiefaia/auth-bridge` (cookie name + JWT verifier). The dashboard adds a `middleware.ts` that reads `__Host-caia` and validates it. **No visual change to the dashboard.**
- Day 30+: dashboard *optionally* migrates components onto `@chiefaia/ui-primitives` as it touches them. No big-bang.

### 6.3 What the website imports

- Everything in §6.1, plus existing workspace packages it will need: `@chiefaia/analytics` (page-view ping), `@chiefaia/dev-inspector` (dev-only overlay), `@chiefaia/logger` (server logs), `@chiefaia/secrets-broker`.

### 6.4 Forbidden cross-imports

- The website **must not** import any code from `apps/orchestrator` or any package that pulls in `better-sqlite3` / `drizzle-orm` — these are server-side dependencies the website's edge-runtime middleware cannot bundle.
- The dashboard **must not** import any code from `apps/website` — direction is one-way.
- A new lint rule in `configs/eslint-config/flat.js`: `no-restricted-imports` enforces both rules.

### 6.5 The "must not break dashboard" pact

The dashboard ships with `AUTH_REQUIRED=false` in local dev (C3 safe rollback). Production dashboard images set `AUTH_REQUIRED=true`. The cutover is:

1. Land `@chiefaia/auth-bridge` package (no consumer change).
2. Add `middleware.ts` to dashboard that **reads** the cookie but only **logs** the verify result for one week. Behaviour unchanged. (`AUTH_MODE=shadow`).
3. Flip `AUTH_MODE=enforce` after the shadow week shows zero false rejects.
4. Add `AUTH_REQUIRED=true` to the dashboard's production Deployment manifest.

Each step is its own PR, behind a feature flag, with a one-line rollback.

---

## 7. Decision matrix

Trade-offs across the load-bearing choices, scored on the rubric: **F**ast-to-ship · **L**ow-cost · **R**eversible · **F**its-existing · **S**ecure.

| Choice | Picked | F | L | R | Fit | Sec | Runner-up | Reason picked |
|---|---|---|---|---|---|---|---|---|
| Framework | Next.js 15 | ✓ | ✓ | – | ✓ | ✓ | Astro | Symmetric with dashboard (C1) |
| Monorepo placement | `apps/website` in caia | ✓ | ✓ | ✓ | ✓ | – | Separate repo | One CI, shared packages (C4) |
| Styling | Tailwind 3 | ✓ | ✓ | ✓ | ✓ | – | CSS-in-JS | Matches site template (C5) |
| Content | MDX in repo | ✓ | ✓ | ✓ | ✓ | – | Headless CMS | Single audience, technical content |
| Deploy primary | k3s stolution-prod | – | ✓ | ✓ | ✓ | ✓ | Vercel | Cookie domain control, existing infra (C7) |
| Deploy preview | Vercel PR previews | ✓ | ✓ | ✓ | – | – | k3s preview ns | Vercel PR UX is unmatched |
| Auth method | GitHub OAuth | ✓ | ✓ | ✓ | ✓ | ✓ | Magic-link, Password+2FA | Audience already on GitHub |
| Session | Stateless JWT, httpOnly cookie, Domain=.caia.dev | ✓ | ✓ | ✓ | – | ✓ | DB-backed session | No session store dependency (C8) |
| Allowlist | GitHub user_id env | ✓ | ✓ | ✓ | – | ✓ | Public sign-up | Operator-only today |
| CI | Six-job evidence gate | – | ✓ | ✓ | ✓ | ✓ | Single-job CI | Conformance with `AGENTS.md` (C4, C6) |
| Dashboard auth rollout | Shadow → enforce | – | ✓ | ✓ | ✓ | ✓ | Big-bang flip | Avoids breaking C3 |
| Shared primitives | New `@chiefaia/design-tokens`, `ui-primitives`, `auth-bridge` | – | ✓ | ✓ | ✓ | ✓ | Copy-paste | Single source of truth for visual + auth contract |

Legend: ✓ = strong, – = neutral, ✗ = weak. No `✗` appears in any picked row.

---

## 8. Open questions for the next chain

These are deliberate punts, surfaced so the implementation chain author sees them before scaffolding:

1. **Domain provisioning.** `caia.dev` — does the operator already own it? If not, register it before chain 2. (Action: operator-only.)
2. **GitHub OAuth app.** Two apps needed (one for `caia.dev`, one for `staging.caia.dev`). Operator must create them in GitHub Developer Settings and stash the client_id/secret in the k8s secret. (Action: operator-only.)
3. **TLS cert.** cert-manager + Let's Encrypt on the existing stolution ingress should cover this; needs an `Issuer` + `Certificate` resource in `infra/stolution/k8s/`. (Action: scaffolded in chain 2.)
4. **Magic-link email provider.** Resend is the recommended default; sign-up + first-month-free covers our volume. Pricing decision is operator-only.
5. **Visual identity / brand.** Out of scope for this chain — handled by the sibling `caia-website-design-system-2026-05-16` chain. This doc assumes its output lands in `@chiefaia/design-tokens`.
6. **Changelog generation.** The `.changeset/` files use a known schema; a tiny build-time script (`apps/website/scripts/build-changelog.ts`) is enough — no new dependency.
7. **Analytics.** `@chiefaia/analytics` already exists. Default to it; do not add Plausible/Fathom/etc. without an ADR.

---

## 9. Summary — what the next chains build

In dependency order, the implementation chains scaffolded from this design are:

1. **`caia-website-scaffold-apps-2026-05-XX`** — create `apps/website` from `templates/site`, wire pnpm workspace, port 7778, CI passing.
2. **`caia-design-tokens-extract-2026-05-XX`** — extract `@chiefaia/design-tokens` from dashboard inline CSS + design-system chain output.
3. **`caia-ui-primitives-extract-2026-05-XX`** — `@chiefaia/ui-primitives` (Button/Input/Card/Modal/Toast).
4. **`caia-auth-bridge-package-2026-05-XX`** — `@chiefaia/auth-bridge` (JWT verifier + cookie constants).
5. **`caia-website-login-flow-2026-05-XX`** — Auth.js v5 config, `/login`, `/callback`, allowlist, session cookie.
6. **`caia-dashboard-middleware-shadow-2026-05-XX`** — dashboard `middleware.ts` in shadow mode.
7. **`caia-dashboard-middleware-enforce-2026-05-XX`** — flip to enforce after one shadow week.
8. **`caia-website-k3s-deploy-2026-05-XX`** — Dockerfile, GHCR push, k8s Deployment/Service/Ingress, ArgoCD app.
9. **`caia-website-content-marketing-2026-05-XX`** — write the actual `/`, `/product`, `/research/*` MDX. Depends on (1) only.

Chains (1) + (9) can run in parallel; (5) blocks on (3) + (4); (7) blocks on (6) + one calendar week.

---

**End of design.** This document is the single source of truth for the architecture of the CAIA public-facing website. Subsequent implementation chains MUST cite this doc as `caia-website-tech-architecture / phase 1` in their phase reports, and any deviation from §1–§7 requires an ADR under `docs/adr/`.
