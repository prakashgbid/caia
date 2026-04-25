# Framework Learnings

Lessons learned while building PokerZeno sites. Each entry records what we learned, why it matters, and what to do about it. These are real failures and fixes — not hypothetical warnings.

---

## L-01: Static export means no API routes — use Supabase Edge Functions instead

`output: 'export'` in `next.config.ts` removes `app/api/` routes entirely at build time. They are not bundled. If you create `app/api/score/route.ts` and try to call it from a static-exported site, the call will 404 in production.

**Fix**: Backend logic goes in Supabase Edge Functions. Call them from `@pokerzeno/backend-core`. See ADR-005.

**Where this burned us**: Initial `roulettecommunity` build had a spin-history API route that worked in dev server but 404'd after first deploy.

---

## L-02: `output: 'export'` breaks `<Image>` optimization — set `unoptimized: true`

Next.js `<Image>` optimization requires a running server to process image transforms on demand. With static export, there's no server — so `next/image` will throw a build error unless you disable optimization.

```typescript
// next.config.ts
const config: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
};
```

Pre-optimize images at build time using `scripts/optimize-images.ts` with `sharp`. Store optimized images in `public/images/` alongside originals. Name convention: `hero.jpg` → `hero-800w.jpg`, `hero-400w.jpg`.

---

## L-03: Cloudflare Pages `_headers` file controls security headers — required for CSP

Cloudflare Pages doesn't have a middleware layer for static sites. The only way to set security headers (`Content-Security-Policy`, `X-Frame-Options`, `Permissions-Policy`) is via a `_headers` file in the `public/` directory (which gets copied to `out/` at build).

If you add a new script source (GA4, Supabase, a widget), you MUST update the `Content-Security-Policy` in `public/_headers` or the browser will block it.

```
# public/_headers
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://*.supabase.co; ...
```

**Where this burned us**: Added Supabase auth client, CORS calls blocked in prod — CSP hadn't been updated to allow `*.supabase.co`.

---

## L-04: pnpm `workspace:*` protocol breaks if package isn't in workspace — always verify pnpm-workspace.yaml

If you add a new package to `pokerzeno-plugins/packages/` but forget to include it in `pnpm-workspace.yaml`, pnpm will try to resolve `workspace:*` by looking on the npm registry. This fails silently during `pnpm install` (it just skips the package) and then fails noisily at build time when the import can't be resolved.

**Fix**: After adding a new package directory, immediately verify `pnpm-workspace.yaml` includes it:
```yaml
packages:
  - 'packages/*'  # This wildcard covers all subdirectories — preferred
```

Using `packages/*` (wildcard) instead of listing each package avoids this class of error entirely.

---

## L-05: Tailwind purge must include all component files — missing glob = missing styles in prod

Tailwind's JIT engine scans files listed in `content` (formerly `purge`) to determine which utility classes to include in the build. If `@pokerzeno/ui` components use classes that aren't referenced in the site's own code, those classes get purged.

```typescript
// tailwind.config.ts — CORRECT
export default {
  content: [
    './src/**/*.{ts,tsx}',
    './node_modules/@pokerzeno/ui/dist/**/*.{js,mjs}',  // REQUIRED
  ],
}
```

Without the second glob, buttons from `@pokerzeno/ui` will render without styles in production. Looks fine in dev (JIT sees all files) but breaks in prod.

---

## L-06: Playwright tests must use `baseURL` from config — hardcoded localhost ports break CI

CI runs Playwright against either a preview deployment URL or a different port than local dev. Hardcoded `http://localhost:3000` in test files breaks CI.

```typescript
// playwright.config.ts — CORRECT
export default defineConfig({
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
  },
});

// test file — CORRECT
await page.goto('/');

// test file — WRONG
await page.goto('http://localhost:3000/');  // breaks CI
```

---

## L-07: `output: 'export'` + `trailingSlash: true` required for Cloudflare Pages SPA routing

Without `trailingSlash: true`, Next.js generates `/about.html` for the about page. Cloudflare Pages serves `/about.html` fine at `/about.html` but returns 404 at `/about`.

With `trailingSlash: true`, Next.js generates `/about/index.html`. Cloudflare Pages correctly serves this at `/about/`.

```typescript
// next.config.ts
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,  // REQUIRED for CF Pages
};
```

---

## L-08: Supabase anon key is public — never confuse with service_role key

The `NEXT_PUBLIC_SUPABASE_ANON_KEY` is designed to be public — it's embedded in the browser bundle. Row Level Security (RLS) policies protect data. The `service_role` key bypasses RLS entirely and should never be in frontend code.

- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — in `.env.local`, safe to commit to Cloudflare Pages env vars
- `SUPABASE_SERVICE_ROLE_KEY` — only in Supabase Edge Functions environment, never in site code

If you see `SUPABASE_SERVICE_ROLE_KEY` referenced in a Next.js file, stop and fix it immediately.

---

## L-09: GA4 consent gate must fire before any tracking call — audit via Network tab

The `@pokerzeno/analytics` wrapper checks `localStorage.getItem('pk_consent')` before every tracking call. But if GA4's `gtag.js` script is loaded in the `<head>` unconditionally (without the consent check), it fires a pageview automatically.

Load the GA4 script only after consent:
```typescript
// ConsentBanner.tsx — on accept
localStorage.setItem('pk_consent', 'accepted');
loadGtag(measurementId);  // dynamically inserts <script>
trackPageView();
```

Verify via Network tab: on first visit with no prior consent, no calls to `google-analytics.com` should appear.

---

## L-10: `turbo run build` with `dependsOn: ["^build"]` ensures dependency packages build first

If package A depends on package B (`workspace:*`), running `turbo run build` without proper pipeline config may build A before B finishes, resulting in A importing from B's unbuilt source files.

The `^build` syntax in Turborepo means "build all dependencies of this package first":
```json
// turbo.json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"]  // REQUIRED
    }
  }
}
```

Without this, parallel builds race and you get intermittent "cannot find module" errors that disappear on retry.

---

## L-11: `git worktree` for parallel development — avoids branch switching disruption

When working on two features simultaneously (e.g., site content + a plugin update), `git worktree add` creates a second working directory for the same repo at a different branch. This is faster than stashing + branch switching and avoids accidentally editing the wrong branch.

```bash
git worktree add ../pokerzeno-plugins-feature ../pokerzeno-plugins -b feat/new-hook
cd ../pokerzeno-plugins-feature
# work here independently
```

Remove when done: `git worktree remove ../pokerzeno-plugins-feature`

---

## L-12: Never hard-delete: always soft-delete with status field

In Supabase tables, never use `DELETE` for user-facing records. Use a `status` column:
- `'active'` — normal state
- `'deleted'` — soft deleted, excluded from queries via RLS policy
- `'banned'` — for user accounts

```sql
-- WRONG
DELETE FROM scores WHERE id = $1;

-- CORRECT
UPDATE scores SET status = 'deleted', deleted_at = now() WHERE id = $1;
```

Hard deletes break event logs, audit trails, and are irreversible. RLS policies filter `WHERE status != 'deleted'` automatically.

---

## L-13: Pre-commit hooks must be idempotent — `verify:all` must pass on clean state

The `verify:all` pre-commit hook must produce a passing result on a clean, correctly-set-up repository. If running `verify:all` on a freshly-cloned repo (after `pnpm install`) fails, the hook is broken and developers will disable it.

Common causes of non-idempotent `verify:all`:
- Test that requires a running dev server
- Build step that writes to a file that's in `.gitignore` and then checked at test time
- Lint rule that only fails on the first run due to cache state

Run `verify:all` on a clean clone as part of any template change. If it fails, fix before releasing the template change.

---

## L-14: New site setup takes < 30 min with template — if longer, fix the template

If setting up a new site from `pokerzeno-site-template` takes more than 30 minutes, the template is broken — not the developer. Acceptable tasks in setup:

- Run `new-site.sh`: < 2 min
- `pnpm install`: < 3 min
- Fill in `.env.local` (2 values): < 2 min
- Edit `SITE_BRAND_LOCK.md`: < 5 min
- Edit `layout.tsx` (name + description): < 2 min
- Create Cloudflare Pages project: < 5 min
- Add GitHub secrets + first push: < 5 min
- Verify live URL: < 5 min

Total: ~29 minutes. If any step requires troubleshooting or undocumented fixes, document it here and fix the template.
