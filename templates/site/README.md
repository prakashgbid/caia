# {{SITE_NAME}} — Site Template

This is the canonical PokerZeno site template. **Do not develop in this repo directly.**

To create a new site, use the scaffold script from the `framework` repo:

```bash
cd framework
bash bin/new-site.sh <slug>
# Example: bash bin/new-site.sh blackjack-hub
```

The script clones this template, replaces all `{{SITE_NAME}}`, `{{DOMAIN}}`, and `{{SLUG}}` placeholders, runs `npm install`, and initializes a git repo.

---

## Template Structure

```
src/
  app/
    layout.tsx          # Root layout with Header + Footer
    page.tsx            # Home page placeholder
    globals.css         # Tailwind base + skip-link styles
  components/
    Header.tsx          # Generic top nav — add brand colors after scaffold
    Footer.tsx          # Generic footer
tailwind.config.ts      # Tailwind — extend theme for site brand
tsconfig.json           # TypeScript strict config
next.config.mjs         # Next.js config with {{DOMAIN}} image domain
package.json            # Dependencies — poker-zeno packages as baseline
.claude/
  settings.local.json   # Wildcard allow list for Claude Code
```

---

## After Scaffolding

1. Update `tailwind.config.ts` with site brand colors
2. Replace `src/components/Header.tsx` with site-specific nav
3. Update `src/app/page.tsx` with real home page content
4. Add `public/favicon.svg`
5. Run `npm run dev` and verify the home page renders

---

## Locks

All sites must comply with locks defined in `framework/locks/`:
- `ACCESSIBILITY.md` — WCAG 2.1 AA, enforced by CI
- `POKERZENO-BRAND.md` — shared brand rules
- `DOMAINS.md` — registered domain registry
- `BEHAVIOR-TESTING.md` — Playwright behavior test requirements
