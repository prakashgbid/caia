# Runbook: Scaling from 2 to 150 Sites

**Use case**: Strategy guide for growing the PokerZeno network from the current 2 sites to 20, 50, or 150 sites while maintaining quality, consistency, and zero marginal infrastructure cost.

---

## The Economics at Scale

Before scaling, confirm the math works:

| Resource | Cost at 2 sites | Cost at 150 sites |
|----------|----------------|-------------------|
| Cloudflare Pages hosting | Free | Free (unlimited sites) |
| Cloudflare bandwidth | Free | Free (unlimited) |
| Supabase database | Free (1 project shared or separate free projects) | ~$25/mo if all on Pro (optional — many sites can share free tier) |
| GitHub repos | Free (unlimited public) | Free |
| GitHub Actions (CI minutes) | ~50 min/mo | ~3,750 min/mo (estimated) — within free tier for public repos |
| Domain registration | $10-15/domain/year | $10-15 × 150 = $1,500-2,250/year |

The only meaningful cost scaling is domain registration. Hosting is genuinely zero.

---

## Shared Infrastructure

### One monorepo for all packages: `pokerzeno-plugins`

All shared code (`@pokerzeno/ui`, `@pokerzeno/analytics`, etc.) lives in one repo. Sites install from GitHub Packages. A single `pnpm changeset publish` pushes updates to all sites simultaneously (on their next rebuild).

Site update flow:
1. Bug fixed in `@pokerzeno/ui`
2. `pnpm changeset publish` → new version on GitHub Packages
3. Run `scripts/update-all-sites.sh` → bumps version in all site `package.json` files
4. Each site's CI runs `verify:all` → deploys if passing

### One framework repo for decisions: `pokerzeno-framework`

This repo. All ADRs, locks, runbooks in one place. When architectural decisions change, update once here.

---

## Naming Conventions

Consistency in naming makes management at scale much easier.

### Repository Names

Pattern: `[primary-game]-community` or `[primary-game]zeno`

Examples:
- `pokerzeno` — flagship
- `roulettecommunity` — roulette
- `blackjackzeno` — blackjack
- `bacarratzeno` — baccarat
- `texasholdem-tips` — variant-specific
- `omaha-poker` — variant-specific

### Cloudflare Pages Project Names

Match the repository name exactly: `pokerzeno`, `roulettecommunity`, `blackjackzeno`

### Supabase Projects

Pattern: `pz-[game]` → `pz-poker`, `pz-roulette`, `pz-blackjack`

### GitHub Secrets

Standardize secret names across all repos. Each repo gets:
```
CLOUDFLARE_API_TOKEN       (same token works for all projects)
CLOUDFLARE_ACCOUNT_ID      (same for all)
NPM_AUTH_TOKEN             (same for all — read:packages scope)
NEXT_PUBLIC_SUPABASE_URL   (site-specific — set in CF Pages env vars, not GH secrets)
```

---

## Adding a New Site: The Repeatable Process

At 20+ sites, new site setup must be mechanical. Time target: 30 minutes.

1. Register domain (if needed)
2. Create GitHub repo from template: `gh repo create pokerzeno-org/site-name --template pokerzeno-site-template --private`
3. Clone locally: `git clone git@github.com:pokerzeno-org/site-name.git`
4. Run setup script: `./scripts/new-site.sh . "SiteName"`
5. Follow `locks/NEW_SITE_CHECKLIST.md` (15 steps, ~25 min)
6. Log launch in `pokerzeno-framework/decisions-log.md`

If any step takes more than its budgeted time, the template needs fixing — not the process.

---

## GitHub Organization Considerations

At 20+ repos, a GitHub Organization is strongly recommended over a personal account:

- Team permissions (if you hire someone later)
- Organization-level secrets (one `CLOUDFLARE_API_TOKEN` secret shared across all repos — no need to set it per-repo)
- Centralized billing view
- GitHub Packages published to org namespace: `@pokerzeno-org/ui`

Create organization: GitHub → New organization → Free plan is sufficient.

Transfer existing repos to org: Settings → Transfer repository.

---

## Content Differentiation Strategy

With 150 sites on the same framework, the risk is "content farms" — identical thin content on every site. This is penalized by Google and is bad for users.

### Differentiation approaches

**Variant specificity**: Each site covers a narrow topic deeply.
- `pokerzeno` — general poker strategy
- `texasholdem.community` — Texas Hold'em only, much deeper content on that variant
- `omaha-tips.com` — Omaha Hi/Lo specific strategy

**Audience targeting**: Same game, different skill levels.
- `pokerbeginners.io` — beginner-focused, concepts explained from scratch
- `pokerpro-strategy.com` — advanced GTO concepts, solver outputs

**Regional targeting**: Same game, localized content.
- Language and currency-appropriate examples
- Locally relevant regulations section

**Game intersection**: Unique angle.
- `casino-math.io` — probability and math behind all card games
- `card-game-odds.com` — odds calculators for multiple games

### Content seed differentiation

The `@pokerzeno/content-engine` `seed` command accepts a `--focus` flag:
```bash
pnpm dlx @pokerzeno/content-engine seed \
  --site texas-holdem-tips \
  --focus "texas-holdem" \
  --audience "intermediate" \
  --count 80
```

Each site's seed should use appropriate `--focus` and `--audience` to produce differentiated starting content. Human editing after seed is required for quality.

---

## Monitoring Strategy

### Per-site monitoring (lightweight)

Each site has its own GA4 property. No per-site server monitoring is needed (static files — no server to monitor). Cloudflare automatically alerts on unusual error rates.

Set up a GA4 alert per site for:
- Sessions drop > 50% week-over-week (potential penalty or technical issue)
- Bounce rate spike > 90% (potential UX or content issue)

### Cross-site monitoring

Create a GA4 rollup property that aggregates all PokerZeno sites. Use it for:
- Network-wide traffic trends
- Comparing which content types perform best
- Identifying which sites need content investment

### Uptime monitoring

Use Cloudflare's built-in health checks (free) or UptimeRobot (free for 50 monitors) to ping each site's homepage daily. Alert on non-200 response.

### Integrity monitoring

Weekly cron job (GitHub Actions scheduled workflow in `pokerzeno-plugins`):
```yaml
on:
  schedule:
    - cron: '0 6 * * 1'  # Every Monday at 6am UTC
```

Job: iterate over all known site repos, trigger `verify:all` on latest deployed build, post summary to a Slack channel or email.

---

## The 150-Site Ceiling

Practical constraints before reaching 150 sites:

1. **Domain management**: 150 domains × $12/year = $1,800/year. Not a blocker but requires tracking (use a spreadsheet or Notion table with expiry dates).

2. **Content quality**: Beyond ~30 sites, AI-assisted content generation becomes necessary to maintain quality. `@pokerzeno/content-engine` is designed to integrate with LLM APIs for this purpose.

3. **Supabase free tier**: Each free project has 500MB database storage. Most sites won't need more. If a site grows, upgrade that specific project to Pro ($25/mo). You don't need to upgrade all projects.

4. **GitHub Actions minutes**: Public repos have unlimited free minutes. Private repos have 2,000 free minutes/month on the free plan. At 150 sites × 3 builds/day × 2 min/build = 900 min/day. This would exceed free tier limits for private repos. Either keep repos public or switch to Cloudflare Pages' native GitHub integration (which has no minute limits).

5. **Solo bandwidth**: 150 sites is a lot of content to maintain for one person. The framework is designed to minimize maintenance, but new site creation still requires ~30 minutes each. Building 150 sites at one per week takes 3 years. This is a strategic constraint, not a technical one.
