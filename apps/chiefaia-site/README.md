# chiefaia-site

Single-file placeholder for **www.chiefaia.com**, served from Cloudflare Pages.

## What this is

A static `index.html` (~5 KB, no framework, no build step, no dependencies) shown while the full site is in development. Theme follows light/dark via `prefers-color-scheme`.

Public branding is "Chief AI Agent" — internal codename "CAIA" deliberately does not appear in any public content.

## Why minimal

A previous iteration scaffolded a Next.js app (PR #496, closed). That was reverted in favor of this placeholder because:

1. The 5 high-fidelity mockups it was designed to host are being deleted (separate cleanup task).
2. The real public site will be designed by the design-agent track later; no point baking decisions now.
3. A single static file deploys in seconds to Cloudflare Pages and costs literally zero — perfect for a "coming soon" page.

## Deploy

Target: **Cloudflare Pages** (free tier).
Project name (proposed): `chiefaia`
Production branch: `main`
Build command: *(none — static)*
Output directory: `apps/chiefaia-site`

Once a Cloudflare account exists and a Pages project is connected to this repo via GitHub, every push to `main` that touches this directory auto-deploys. PRs get preview URLs at `https://<sha>.<project>.pages.dev`.

## Local preview

```bash
cd apps/chiefaia-site
python3 -m http.server 7780
# open http://localhost:7780
```

## Future evolution

When the design-agent track produces a real design and content, this file gets replaced (or a Next.js / static-site-generator setup gets layered on top). Until then, keep it boring.
