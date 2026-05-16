# @caia-app/chiefaia-site

Public-facing marketing site for CAIA (Chief AI Agent) — served at
**www.chiefaia.com**.

## Status

**Scaffold only.** Pages are intentional placeholders until the operator
confirms which mockups in `apps/website-mockups/` are final. The scaffold
exists so the deploy plumbing (DNS, SSL, CI, hosting) can be wired up in
parallel with content sign-off.

## Deploy target

**Cloudflare Pages** (free tier). Picked over Vercel hobby and Caddy-on-stolution
because (a) zero ongoing $, (b) unmetered bandwidth, (c) free SSL via universal
cert, (d) per-PR preview deployments, (e) instant rollback, (f) edge-fast, and
(g) no servers for ops to babysit. See
`~/Documents/projects/agent-memory/decisions/chiefaia_deploy_runbook_2026_05_16.md`.

Build command: `pnpm --filter @caia-app/chiefaia-site build`
Output dir: `apps/chiefaia-site/.next`

## Routes

| Route | File | Mockup source |
| --- | --- | --- |
| `/` | `app/page.tsx` | `apps/website-mockups/home.html` |
| `/architecture` | `app/architecture/page.tsx` | `apps/website-mockups/architecture.html` |
| `/packages` | `app/packages/page.tsx` | `apps/website-mockups/packages.html` |
| `/login` | `app/login/page.tsx` | `apps/website-mockups/login.html` |
| `/dashboard-preview` | `app/dashboard-preview/page.tsx` | `apps/website-mockups/dashboard-preview.html` |

> The spec asked for `app/(dashboard-preview)/page.tsx` (route group), but route
> groups don't add URL segments in Next.js App Router — that would collide with
> the home page. Using a regular segment `/dashboard-preview` instead.

## Relationship to website-mockups

The mockups in `apps/website-mockups/` are high-fidelity HTML+Tailwind-CDN
prototypes (PR #489). They are NOT imported at runtime — each Next.js page is
an empty stub. When the operator approves a mockup, port its markup into the
matching `page.tsx`, swap the Tailwind CDN for the local Tailwind setup (already
configured with the same design tokens), and ship.

## Design tokens

`tailwind.config.js` mirrors the theme from the mockups (ink/chalk/brand/
accent/mint/amber/rose/sky scales + Inter/JetBrains Mono fonts). If we later
introduce a shared `@caia-app/design-tokens` package, swap to that.

`apps/dashboard/` does NOT currently use Tailwind (plain CSS); sharing tokens
with it would require migrating the dashboard or extracting tokens into a
framework-neutral package. Out of scope for this scaffold.

## Local development

```bash
pnpm install
pnpm --filter @caia-app/chiefaia-site dev    # http://localhost:7780
pnpm --filter @caia-app/chiefaia-site build  # production build
pnpm --filter @caia-app/chiefaia-site typecheck
```

## CI / CD

To be wired up after operator approves hosting + content. Recommended:
Cloudflare Pages auto-deploys from `main` (production) and from every PR
(previews) using the build command above.
