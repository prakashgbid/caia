# Runbook: Start a New Site

**Use case**: You've decided to launch a new card game community site (poker variants, roulette, blackjack, baccarat, etc.) on the PokerZeno framework.

**Prerequisites before starting**:
- `pokerzeno-site-template` repo is cloned and up to date on your machine
- Cloudflare account exists and you have API token with `Pages:Edit` permission
- Supabase project is created (or you'll create one during setup)
- GitHub repo is created for the new site (can be done mid-process)
- Node.js 20+ and pnpm 9+ installed locally

Expected time: 25-30 minutes.

---

## Step 1: Scaffold from the template

Navigate to the parent directory that should contain the new site (same level as other sites):

```bash
cd ~/projects  # wherever your sites live
```

Run the scaffold script from the template repo:

```bash
./pokerzeno-site-template/scripts/new-site.sh ./my-new-site "MySiteName"
# Arguments: <target-path> <site-display-name>
```

Expected output:
```
Creating site: MySiteName at ./my-new-site
Copying template...
Replacing placeholder SITE_TEMPLATE with MySiteName...
Initializing git repo...
Done. Next: cd ./my-new-site && bash scripts/install-hooks.sh
```

If the script doesn't exist yet, clone manually:
```bash
git clone git@github.com:prakashmailid/pokerzeno-site-template.git ./my-new-site
cd ./my-new-site
git remote remove origin
# rename the template placeholder in package.json
sed -i '' 's/pokerzeno-site-template/my-new-site/g' package.json
```

---

## Step 2: Install hooks and dependencies

```bash
cd ./my-new-site

# Install git hooks (pre-commit: verify:all, post-commit: auto-push)
bash scripts/install-hooks.sh
```

Expected output:
```
Configuring .npmrc for @pokerzeno packages...
Installing hooks...
pre-commit hook installed
post-commit hook installed
Hooks installed successfully.
```

Then install dependencies:
```bash
pnpm install
```

Expected: `node_modules` populated. `@pokerzeno/ui`, `@pokerzeno/analytics`, `@pokerzeno/backend-core` should be listed in the install output. If any `@pokerzeno` package fails to resolve, check `.npmrc` contains:
```
@pokerzeno:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_AUTH_TOKEN}
```

And that `NPM_AUTH_TOKEN` is set to a GitHub personal access token with `read:packages` scope.

---

## Step 3: Configure brand

Open `SITE_BRAND_LOCK.md` in the repo root and fill in every field:

```markdown
# SITE_BRAND_LOCK.md

site_name: MySiteName
domain: mysite.com
primary_color: "#6d28d9"      # override if different from brand-purple
suit_icon: "♠"                # primary suit/icon for logo
ga4_id: "G-XXXXXXXXXX"        # fill in after GA4 property created
supabase_project_ref: "xxxx"  # your Supabase project ref
launched: ""                  # fill in after first deploy
```

---

## Step 4: Configure environment

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in:
```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
NEXT_PUBLIC_GA4_ID=G-XXXXXXXXXX
NEXT_PUBLIC_SITE_NAME=MySiteName
NEXT_PUBLIC_SITE_DESCRIPTION=A 150-character description for SEO
```

Get Supabase values from: Supabase Dashboard → your project → Settings → API.

Do NOT commit `.env.local`. Verify it's in `.gitignore` (it should be by default).

---

## Step 5: Customize layout

Open `src/app/layout.tsx`. Find and replace these template values:

```tsx
export const metadata: Metadata = {
  title: {
    default: 'MySiteName',
    template: '%s — MySiteName',
  },
  description: 'Your 150-character SEO description of what this site offers.',
  // Update canonical URL:
  metadataBase: new URL('https://mysite.com'),
};
```

Open `src/app/page.tsx` and update the homepage hero text if it still shows template placeholder content.

---

## Step 6: Run the quality gate

```bash
pnpm run verify:all
```

This runs: build → unit tests → E2E tests → integrity check. All must pass before pushing.

**If build fails:**
- TypeScript errors: most common cause is an unfilled placeholder that's typed as a specific enum. Fix the value.
- Missing env var: `process.env.NEXT_PUBLIC_*` referenced but not in `.env.local` — add it.

**If unit tests fail:**
- Component snapshot mismatches due to site name change — run `pnpm run test -- --update-snapshots`

**If Playwright tests fail:**
- Playwright may need browser binaries: `pnpm dlx playwright install chromium`
- Tests run against `out/` — make sure `pnpm run build` succeeded first
- `BASE_URL` defaults to `http://localhost:3000` — run `pnpm run preview` in a separate terminal before running E2E

**If integrity-check fails:**
- Check the output — it tells you exactly which pages failed and why
- Common: homepage template not updated yet, layout.tsx still has placeholder `<title>`

---

## Step 7: Create the Cloudflare Pages project

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers & Pages → Create application → Pages
2. "Connect to Git" → authorize GitHub → select the `my-new-site` repo
3. Configure build:
   - **Framework preset**: None
   - **Build command**: `npm run build`
   - **Build output directory**: `out`
4. Add environment variables (Production):
   ```
   NODE_VERSION = 20
   NEXT_PUBLIC_SUPABASE_URL = [value]
   NEXT_PUBLIC_SUPABASE_ANON_KEY = [value]
   NEXT_PUBLIC_GA4_ID = [value]
   NEXT_PUBLIC_SITE_NAME = [value]
   NEXT_PUBLIC_SITE_DESCRIPTION = [value]
   ```
5. Click "Save and Deploy" — this triggers the first build directly from GitHub

---

## Step 8: Configure GitHub Actions deployment

Add secrets to the GitHub repo (Settings → Secrets and variables → Actions):
```
CLOUDFLARE_API_TOKEN = [token with Pages:Edit permission]
CLOUDFLARE_ACCOUNT_ID = [found in CF dashboard right sidebar under "Account ID"]
```

Edit `.github/workflows/deploy.yml`:
```yaml
- uses: cloudflare/pages-action@v1
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    projectName: my-new-site    # CHANGE THIS to your CF Pages project name
    directory: out
    gitHubToken: ${{ secrets.GITHUB_TOKEN }}
```

---

## Step 9: Push and verify deploy

```bash
git add .
git commit -m "chore: initial site setup — MySiteName"
# post-commit hook auto-pushes to origin
```

If origin isn't set yet:
```bash
git remote add origin git@github.com:prakashmailid/my-new-site.git
git push -u origin main
```

Watch the GitHub Actions run in the Actions tab. A successful run shows:
- "build" job: green
- "deploy" job: green, with a Cloudflare Pages deployment URL

---

## Step 10: Smoke test the live site

Open the Cloudflare Pages URL (format: `https://my-new-site.pages.dev`):

1. Page loads without console errors
2. Tab through the page — skip link appears, focus indicators visible
3. On mobile viewport (375px) — layout is correct, no horizontal scroll
4. Open Network tab — no GA4 calls on first load (consent gate working)
5. Accept consent banner — GA4 pageview fires (visible in Network tab)
6. Check GA4 Realtime report — pageview appears

Run Lighthouse (Chrome DevTools → Lighthouse → Analyze):
- Performance: ≥ 90 ✓
- Accessibility: 100 ✓ (if < 100, do not proceed — fix first)
- Best Practices: ≥ 90 ✓
- SEO: ≥ 90 ✓

---

## Step 11: Log the launch

Add an entry to `pokerzeno-framework/decisions-log.md` noting:
- Date launched
- Site name and domain
- Cloudflare Pages project name
- Supabase project ref
- Any template deviations made

---

## Common Problems

| Problem | Cause | Fix |
|---------|-------|-----|
| `pnpm install` fails on `@pokerzeno/*` | Missing `.npmrc` or no GitHub auth token | Check `.npmrc` config, set `NPM_AUTH_TOKEN` env var |
| Build error: "Image optimization requires..." | Missing `images.unoptimized: true` | Add to `next.config.ts` (see L-02) |
| 404 on direct URL visit | Missing `trailingSlash: true` | Add to `next.config.ts` (see L-07) |
| GA4 fires before consent | Script loaded in `<head>` unconditionally | Use dynamic script load via `@pokerzeno/analytics` (see L-09) |
| Cloudflare build fails: "Cannot find module" | Missing env var in CF Pages settings | Add all `NEXT_PUBLIC_*` vars to CF Pages environment |
| Integrity check fails: skip link missing | Template layout not updated | Ensure `<a href="#main-content">` is first focusable element in layout |
| Playwright: "browserType.launch: Executable doesn't exist" | Browser binaries not installed | Run `pnpm dlx playwright install chromium` |
