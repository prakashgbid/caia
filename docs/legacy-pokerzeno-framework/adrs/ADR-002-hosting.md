# ADR-002: Hosting Platform

**Date**: 2026-04-15
**Status**: Accepted
**Deciders**: Prakash (solo founder)

---

## Context

We need a hosting platform for 20-150 static Next.js sites. Requirements:

- Free or near-zero cost per additional site
- Global CDN with edge caching (SEO + performance)
- Automatic HTTPS and custom domain support
- GitHub-integrated deployment (push to deploy)
- Ability to set custom HTTP response headers (required for CSP, HSTS, Permissions-Policy)
- No Node.js server needed (all sites are static export)

---

## Decision

**Cloudflare Pages** for all PokerZeno sites.

Deployment configuration:
- Build command: `npm run build`
- Output directory: `out`
- Node.js version: `20` (set via `NODE_VERSION` env var in Pages settings)
- GitHub integration: `cloudflare/pages-action` GitHub Action in `.github/workflows/deploy.yml`
- Security headers: `_headers` file in `public/` directory (copied to `out/` at build)
- Environment variables: set per-project in Pages dashboard (never committed to repo)

Example `_headers` file:
```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; ...
```

---

## Consequences

**Positive**:
- Unlimited sites on free tier — zero marginal hosting cost per new site
- Unlimited bandwidth on free tier (as of 2025, Cloudflare has not changed this for Pages)
- HTTP/3 and QUIC enabled globally without any configuration
- Cloudflare's Anycast network means requests route to the nearest PoP automatically
- `_headers` file provides full HTTP header control — no middleware or proxy needed
- Preview deployments per branch (every PR gets a preview URL)

**Negative / Trade-offs**:
- Build minutes are limited on free tier (500/month). With 150 sites each deploying daily, this could become a constraint. Mitigation: only deploy on change (Cloudflare detects no-change deploys and skips them)
- No server-side compute at the edge without Cloudflare Workers (which costs money). Accepted — we use Supabase Edge Functions for backend logic
- Dashboard is per-project; managing 150 projects requires discipline (naming conventions, tagging)

---

## Alternatives Considered

**Vercel** — rejected. Free tier limits to 1 concurrent build and imposes bandwidth limits per project. At 150 sites, pro plan becomes necessary at ~$20/month per team, plus per-seat pricing. Cost doesn't scale favorably. Also introduces potential vendor lock-in via Vercel-specific features (ISR, Edge Middleware).

**Netlify** — rejected. Similar pricing model to Vercel — team plan required for multiple projects, bandwidth overages billed. The DX is good but the economics don't work at our scale.

**GitHub Pages** — rejected. No custom HTTP headers (no `_headers` equivalent), no edge CDN (GitHub's CDN is Fastly but configuration is limited), no preview deployments per PR, and HTTPS on custom domains requires manual certificate management.

**AWS S3 + CloudFront** — rejected. Requires operational overhead (S3 bucket config, CloudFront distribution per site, ACM certificates, Route53). Works well but the setup cost per site is too high for a solo founder.
