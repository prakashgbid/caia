# Domain Lock

**Status**: Enforced — no site may use an unlisted domain in production  
**Owner**: Prakash (solo founder)  
**Updated**: 2026-04-20

---

## Registered Domains

| Domain | Site Repo | Status | Notes |
|--------|-----------|--------|-------|
| pokerzenith.com | poker-zeno | Active | Primary poker site |
| roulettecommunity.com | roulette-community | Active | Roulette strategy + community |

---

## Domain Registration Rules

1. All domains must be registered before `new-site.sh` is run with that domain.
2. DNS must point to the Vercel project for the corresponding site repo.
3. `www.` subdomain must redirect to apex domain (naked domain is canonical).
4. Domain must be listed in this file within 24 hours of registration.

---

## Reserved / Planned Domains

| Domain | Intended Site | Priority |
|--------|---------------|----------|
| (none yet) | — | — |

---

## DNS Template

Every production site uses this Vercel DNS setup:

```
A     @         76.76.21.21   (Vercel IP)
CNAME www       cname.vercel-dns.com
```

---

## Naming Convention

Sites follow `<game>zenith.com` or `<game>community.com` pattern where possible.
Avoid hyphens in domain names (harder to type, worse for brand recall).
