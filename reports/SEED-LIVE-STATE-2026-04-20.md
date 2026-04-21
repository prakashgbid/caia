# Conductor Live-State Seed Report
**Date:** 2026-04-21T00:02:41Z  
**Seeded by:** Claude Code (auto-session)

---

## Summary

| Table        | Before | After (active) |
|--------------|--------|----------------|
| Requirements | 33     | 53 (total)     |
| Blockers     | 0      | 5 (4 open, 1 resolved) |
| Questions    | 0      | 6 (all open)   |

---

## Root cause of missing data

The conductor MCP process (PID 45864) had started at **18:32** from a dist that predated the blockers/questions code (dist rebuilt at **19:42**). The server passed `undefined` for `blockersManager`/`questionsManager` to the HTTP handler, causing all `/blockers` and `/questions` requests to fall through to `404 Not found`.

**Fix:** seeded data directly via manager modules → killed stale process → started fresh server (PID 59404) → verified all endpoints return correct data.

---

## Requirements created (20 track-level)

### Done (12)
| ID | Title |
|----|-------|
| req_elb9XW6Z | Style + Content overhaul |
| req_FFoT8PAf | PokerZeno Play v4 |
| req_6FvqbQ94 | Roulette Play v3 respawn |
| req_RieNkPkf | SEO program clean respawn |
| req_mCQcX-83 | Gameplay E2E tests + fixes |
| req_EPfLoGEs | Backend architecture v1 package |
| req_AqXwS_Ie | Cast-bridge v1 package |
| req_jAkBMCWf | Accessibility WCAG 2.1 AA pass |
| req_35GymLLQ | Link + action integrity sweep |
| req_8mmaomQM | GA4 analytics integration (code) |
| req_Vg0-MCRl | Conductor requirements + autopump seed |
| req_fwtk8sik | Conductor blockers + questions tables |

### Executing (4)
| ID | Title |
|----|-------|
| req_MWVv5LA_ | DevInspector package |
| req_YNXYQary | Media enrichment pass |
| req_9eQmO4sS | Content engine + initial seed |
| req_miqYc99D | Repo framework scaffold |

### Blocked (3)
| ID | Title |
|----|-------|
| req_dIEzbSjd | Google Analytics activation |
| req_KlIVvl0Q | DNS activation for roulettecommunity.com |
| req_JPSyCUKI | GitHub repo push (5 repos) |

### Captured (1)
| ID | Title |
|----|-------|
| req_DoL3QRSy | Conductor backend evolution (SQLite + WS + new tabs) |

---

## Blockers created (5)

| ID | Title | State | Severity |
|----|-------|-------|----------|
| blk_aqlJWCzk | Add DNS CNAME records for roulettecommunity.com | open | high |
| blk_b-SURrjO | Create 2 GA4 Properties + paste Measurement IDs | open | high |
| blk_Fw4o2PXw | Authenticate GitHub CLI so 5 repos can be pushed | open | high |
| blk_SKOUyHSi | Pixabay API approval pending | open | low |
| blk_TY3x9ASQ | Enable Cloudflare R2 in dashboard (one-time) | resolved | normal |

---

## Questions created (6)

| ID | Title | Priority |
|----|-------|----------|
| qst_T-CoDGR5 | Conductor backend: Drizzle vs Prisma vs Kysely for SQLite? | normal |
| qst_gBPyuTQC | SQLite file location for Conductor DB? | normal |
| qst_B-9hFlU3 | Conductor API auth strategy (local + cloud)? | normal |
| qst_n33E3_hn | Pixabay pending — ship with Unsplash+Pexels only, or wait? | normal |
| qst_O_dwoEYh | Conductor pump auto-kill of stalled tasks — enable by default? | normal |
| qst_hZzWzS97 | GitHub username for new repos? | urgent |

---

## Final /counts output

```json
{"openBlockers":4,"openQuestions":6}
```

---

## Requirements by state (full breakdown)

| State | Count |
|-------|-------|
| done | 12 |
| executing | 5 |
| ready | 32 |
| blocked | 3 |
| captured | 1 |
| **Total** | **53** |

---

## Seed.ts fix

Updated `/src/mcp/seed.ts` (and rebuilt dist) to guard against duplicate creation on server restart — all 4 affected checks now test against both the old title and the new canonical title.

---

## Dashboard

Open: http://localhost:7777
