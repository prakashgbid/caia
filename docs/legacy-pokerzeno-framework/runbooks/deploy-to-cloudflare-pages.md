# Runbook: Deploy to Cloudflare Pages

**Use case**: Setting up or re-configuring deployment for a PokerZeno site on Cloudflare Pages.

This runbook covers initial setup, environment configuration, custom build settings, GitHub Actions integration, and common deployment failures.

---

## Prerequisites

- Cloudflare account (free tier is sufficient)
- Cloudflare API token with `Cloudflare Pages: Edit` permission
  - Create at: [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
  - Use template: "Edit Cloudflare Workers" → then add Pages permission
- GitHub repo containing the site (with `output: 'export'` Next.js config)
- All `NEXT_PUBLIC_*` environment variables values ready

---

## Step 1: Create the Cloudflare Pages Project

1. Log into [dash.cloudflare.com](https://dash.cloudflare.com)
2. Left sidebar → **Workers & Pages**
3. Click **Create application** → Select **Pages** tab
4. Click **Connect to Git**
5. Authorize GitHub if not already authorized → select the target repository
6. Click **Begin setup**

---

## Step 2: Configure Build Settings

In the "Set up builds and deployments" screen:

| Setting | Value |
|---------|-------|
| Project name | `my-site-name` (lowercase, hyphens — this becomes `my-site-name.pages.dev`) |
| Production branch | `main` |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `out` |

**Why `npm run build` instead of `pnpm run build`?** Cloudflare Pages doesn't guarantee pnpm is available. Use `npm run build` and include a `build` script in `package.json` that calls `next build`. The `package.json` `scripts` section handles the delegation.

---

## Step 3: Add Environment Variables

Still on the setup screen, expand "Environment variables (advanced)" and add:

```
NODE_VERSION            = 20
NEXT_PUBLIC_SUPABASE_URL = https://[ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJ...
NEXT_PUBLIC_GA4_ID      = G-XXXXXXXXXX
NEXT_PUBLIC_SITE_NAME   = MySiteName
NEXT_PUBLIC_SITE_DESCRIPTION = Your 150-char description
```

Set all variables for both **Production** and **Preview** environments (can differ — use separate Supabase projects for preview if needed).

Click **Save and Deploy**. The first deploy will run immediately.

---

## Step 4: Verify First Deploy

Watch the build log in the Pages dashboard. A successful build log ends with:

```
Successfully compiled.
info  - Generating static pages (24/24)
info  - Finalizing page optimization

Route (app)                              Size     First Load JS
┌ ○ /                                    3.2 kB        104 kB
├ ○ /about                               1.1 kB        102 kB
...
● (Static) prerendered as static content
✓ Export successful. Files written to ./out

✓ Deploy complete: https://my-site-name.pages.dev
```

Visit `https://my-site-name.pages.dev` — the site should be live.

---

## Step 5: Set Up GitHub Actions Deployment

This step automates deployment via GitHub Actions on every push to `main` (in addition to or instead of Cloudflare's direct GitHub integration).

The advantage of GitHub Actions: you can run `verify:all` before deploying, blocking broken deployments before they reach Cloudflare.

Add secrets to the GitHub repo (Settings → Secrets and variables → Actions → Repository secrets):
```
CLOUDFLARE_API_TOKEN  = [your API token]
CLOUDFLARE_ACCOUNT_ID = [from CF dashboard, right sidebar "Account ID"]
```

Edit `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v3
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile
        env:
          NPM_AUTH_TOKEN: ${{ secrets.NPM_AUTH_TOKEN }}

      - name: Verify (test + build)
        run: pnpm run verify:all

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: my-site-name          # CHANGE THIS
          directory: out
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}
```

Also add `NPM_AUTH_TOKEN` to GitHub secrets for installing `@pokerzeno/*` packages.

---

## Step 6: Disable Cloudflare's Direct GitHub Integration (Optional)

If using GitHub Actions for deployment, you may want to disable Cloudflare's automatic deploy-on-push to avoid double deploys:

- Pages dashboard → your project → Settings → Builds & deployments
- Under "Branch deployments" → click **Pause deployments** for the `main` branch

Keep preview deployments enabled (they create a staging URL per PR, which is useful).

---

## Security Headers

The `_headers` file in `public/` is automatically copied to `out/` by Next.js. Cloudflare Pages serves it automatically.

Template `public/_headers`:
```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://*.supabase.co; connect-src 'self' https://*.supabase.co https://www.google-analytics.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'
```

Update `script-src` and `connect-src` if adding new third-party scripts.

---

## Troubleshooting

### Build fails: "Environment variable not found"

The build needs `NEXT_PUBLIC_*` vars at build time (they're inlined into the static HTML). If a variable is missing from Cloudflare Pages environment settings, the build fails.

Fix: Pages dashboard → project → Settings → Environment variables → add missing variable → trigger a new deploy.

### 404 on direct URL navigation (e.g., `/about`)

Cause: `trailingSlash: true` is not set in `next.config.ts`, so Next.js generates `/about.html` instead of `/about/index.html`. Cloudflare Pages serves `/about.html` at `/about.html` only.

Fix:
```typescript
// next.config.ts
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,  // REQUIRED
};
```

Rebuild and redeploy. See L-07 in learnings.md.

### Build fails: "next/image" error

Cause: `images.unoptimized` is not set. Fix: see L-02.

### Deploy succeeds but site shows old version

Cloudflare Pages may serve cached assets. Hard purge: Pages dashboard → project → Deployments → click latest deployment → click "Retry deployment". Or wait for cache expiry (CF Pages cache TTL is typically 4 hours).

### Build fails: cannot install `@pokerzeno/*` packages

The GitHub Actions workflow needs `NPM_AUTH_TOKEN` to authenticate with GitHub Packages. Add it as a repository secret and ensure it appears in the `pnpm install` step environment.

### Preview deploys disabled for PRs

By default, Cloudflare Pages creates preview URLs for all branches. If you don't want this for a specific branch pattern, configure branch deploy controls in Pages settings.
