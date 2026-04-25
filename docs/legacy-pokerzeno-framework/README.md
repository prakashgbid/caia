# pokerzeno-framework

The architectural source of truth for all PokerZeno sites. If you're building a new site, starting here is non-negotiable.

## What This Is

This repo is the brain of the PokerZeno multi-site card game framework. It contains every architectural decision, brand rule, accessibility enforcement, and operational runbook needed to build, deploy, and maintain any PokerZeno site — from the first one to the 150th.

It does not contain application code. It governs all repos that do.

## The 5 Repos

| Repo | Role |
|------|------|
| `pokerzeno-framework` | This repo. Decisions, ADRs, locks, runbooks. |
| `pokerzeno-plugins` | pnpm workspaces monorepo. All shared packages: `@pokerzeno/analytics`, `@pokerzeno/backend-core`, `@pokerzeno/ui`, `@pokerzeno/integrity-check`, `@pokerzeno/content-engine`. |
| `pokerzeno-site-template` | Scaffolded Next.js 15 site. Run `./scripts/new-site.sh` to clone and configure. |
| `pokerzeno` | The flagship poker strategy site. Also serves as the living reference implementation. |
| `roulettecommunity` | First satellite site. Built from `pokerzeno-site-template`. |

## Quick Start: Creating a New Site

```bash
# 1. Scaffold from template
git clone git@github.com:prakashmailid/pokerzeno-site-template.git ../my-new-site
cd ../my-new-site

# 2. Install hooks + dependencies
bash scripts/install-hooks.sh
pnpm install

# 3. Configure brand and environment
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
# Edit SITE_BRAND_LOCK.md with site name, domain, palette overrides

# 4. Verify before first push
pnpm run verify:all

# 5. Deploy
git remote set-url origin git@github.com:prakashmailid/MY-NEW-SITE.git
git push -u origin main
```

Full step-by-step: [runbooks/start-a-new-site.md](runbooks/start-a-new-site.md)
New site checklist: [locks/NEW_SITE_CHECKLIST.md](locks/NEW_SITE_CHECKLIST.md)

## Key Documents

- [decisions-log.md](decisions-log.md) — chronological journal of every major decision
- [adrs/](adrs/) — Architecture Decision Records (ADR-001 through ADR-010)
- [locks/](locks/) — immutable rules: accessibility, brand, learnings, new site checklist
- [runbooks/](runbooks/) — step-by-step operational guides
