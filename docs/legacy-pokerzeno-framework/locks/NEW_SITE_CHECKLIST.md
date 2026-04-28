# New Site Checklist

Use this checklist every time you create a new PokerZeno site. Complete every step in order — skipping steps causes issues that are painful to debug later.

Expected total time: **25-30 minutes**. If it takes longer, see L-14 in learnings.md.

---

## Phase 1: Scaffold (5 min)

- [ ] **1. Run the scaffold script**
  ```bash
  cd /path/to/pokerzeno-site-template
  ./scripts/new-site.sh ../my-new-site MySiteName
  ```
  Expected output: "Site scaffolded at ../my-new-site. Run: cd ../my-new-site && bash scripts/install-hooks.sh"

- [ ] **2. Install hooks and dependencies**
  ```bash
  cd ../my-new-site
  bash scripts/install-hooks.sh
  pnpm install
  ```
  Expected output: hooks installed, `node_modules` populated, no errors.

---

## Phase 2: Configure (10 min)

- [ ] **3. Fill in SITE_BRAND_LOCK.md**
  Open `SITE_BRAND_LOCK.md` and fill in:
  - `site_name`: Full site name (e.g., "Blackjack Community")
  - `domain`: Target domain (e.g., `blackjackcommunity.com`)
  - `primary_color`: Override brand-purple if needed, or leave as `#6d28d9`
  - `ga4_id`: Placeholder — fill in after GA4 property is created
  - `suit_icon`: Which suit/icon to use in logo (♠ ♥ ♦ ♣ or other)

- [ ] **4. Set up environment variables**
  ```bash
  cp .env.example .env.local
  ```
  Edit `.env.local`:
  ```
  NEXT_PUBLIC_SUPABASE_URL=https://[your-ref].supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=[your-anon-key]
  NEXT_PUBLIC_GA4_ID=G-XXXXXXXXXX
  NEXT_PUBLIC_SITE_NAME=MySiteName
  ```
  Supabase credentials: get from Supabase dashboard → Settings → API.

- [ ] **5. Edit app/layout.tsx**
  Replace the two template placeholders:
  ```tsx
  // Replace SITE_NAME with your site name
  // Replace SITE_DESCRIPTION with a 150-char SEO description
  export const metadata: Metadata = {
    title: { default: 'MySiteName', template: '%s — MySiteName' },
    description: 'Your 150-char description here',
  };
  ```

- [ ] **6. Update tailwind.config.ts**
  If overriding primary color from brand lock:
  ```typescript
  theme: {
    extend: {
      colors: {
        primary: '#your-override-hex',  // only if different from brand-purple
      },
    },
  },
  ```
  If using default brand-purple, no change needed.

---

## Phase 3: Quality Gate (3 min)

- [ ] **7. Run verify:all — must pass before first push**
  ```bash
  pnpm run verify:all
  ```
  If this fails, fix the issue before proceeding. Do not push a broken initial state.
  Common failures at this stage:
  - Missing `.env.local` values → fill in all required vars
  - TypeScript errors from template placeholders → complete steps 5-6
  - Playwright can't connect → run `pnpm run build && pnpm run preview` first

---

## Phase 4: Deploy (10 min)

- [ ] **8. Create Cloudflare Pages project**
  - Go to: Cloudflare Dashboard → Workers & Pages → Create application → Pages
  - Connect to Git → select this repo
  - Build settings:
    - Framework preset: None (or Next.js Static)
    - Build command: `npm run build`
    - Build output directory: `out`
    - Node.js version: `20` (set as environment variable: `NODE_VERSION=20`)

- [ ] **9. Add environment variables in Cloudflare Pages**
  In the Pages project settings → Environment variables → Add:
  ```
  NEXT_PUBLIC_SUPABASE_URL = [value]
  NEXT_PUBLIC_SUPABASE_ANON_KEY = [value]
  NEXT_PUBLIC_GA4_ID = [value]
  NEXT_PUBLIC_SITE_NAME = [value]
  ```
  Add for both Production and Preview environments.

- [ ] **10. Add GitHub secrets for deployment workflow**
  In the GitHub repo → Settings → Secrets and variables → Actions:
  ```
  CLOUDFLARE_API_TOKEN = [token with Pages:Edit permission]
  CLOUDFLARE_ACCOUNT_ID = [your CF account ID]
  ```
  Then edit `.github/workflows/deploy.yml` → set `projectName` to the Cloudflare Pages project name.

- [ ] **11. Push to trigger first deploy**
  ```bash
  git remote set-url origin git@github.com:prakashmailid/my-new-site.git
  git push -u origin main
  ```
  Watch the GitHub Actions run. Expected: build passes, Cloudflare Pages deploy succeeds.

---

## Phase 5: Verify (5 min)

- [ ] **12. Check the live URL**
  - Site loads with correct name and content
  - No console errors (open DevTools)
  - Skip-to-content link appears on Tab keypress
  - Footer contains responsible gambling link

- [ ] **13. Run Lighthouse**
  In Chrome DevTools → Lighthouse:
  - Performance: ≥ 90
  - Accessibility: 100
  - Best Practices: ≥ 90
  - SEO: ≥ 90

  If Accessibility < 100, do not launch. Fix and redeploy.

- [ ] **14. Create GA4 property (if not done)**
  - GA4 Admin → Create property for this site
  - Copy Measurement ID (G-XXXXXXXXXX) into Cloudflare Pages env vars and `.env.local`
  - Trigger a pageview, verify it appears in GA4 Realtime report

---

## Phase 6: Record

- [ ] **15. Log the new site in pokerzeno-framework**
  Add an entry to `pokerzeno-framework/decisions-log.md`:
  ```markdown
  ## 2026-XX-XX — New site launched: MySiteName
  Domain: mysite.com
  Cloudflare Pages project: my-site-name
  Supabase project: [ref]
  GA4 property: G-XXXXXXXXXX
  Notes: [any deviations from standard template]
  ```

---

## Reference

- Full setup runbook with troubleshooting: `runbooks/start-a-new-site.md`
- Cloudflare deployment details: `runbooks/deploy-to-cloudflare-pages.md`
- Custom domain attachment: `runbooks/attach-custom-domain.md`
- Brand spec: `locks/pokerzeno-brand-lock.md`
- Accessibility requirements: `locks/accessibility-lock.md`
