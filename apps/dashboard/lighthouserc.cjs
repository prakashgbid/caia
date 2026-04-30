// apps/dashboard/lighthouserc.cjs
//
// Lighthouse CI config for the dashboard preview build.
// Boots `next start -p 7777` and audits the canonical routes.
//
// Thresholds (per third-party-caia-paper-analysis §C.2 + the operator
// mandate's tighter floor on perf):
//   performance     ≥ 0.80
//   accessibility   ≥ 0.90
//   best-practices  ≥ 0.90
//   seo             ≥ 0.90
//
// Doc: caia/docs/evidence-gate.md

module.exports = {
  ci: {
    collect: {
      // Boot the production build before collecting.
      startServerCommand: 'pnpm --filter @caia-app/dashboard start',
      startServerReadyPattern: 'started server on',
      startServerReadyTimeout: 60000,
      url: [
        'http://localhost:7777/',
        'http://localhost:7777/timeline',
        'http://localhost:7777/buckets',
        'http://localhost:7777/architecture',
        'http://localhost:7777/contracts',
        'http://localhost:7777/prompts',
      ],
      numberOfRuns: 1,
      settings: {
        // CI runner is shared infra — desktop preset is most stable.
        preset: 'desktop',
        // Skip a few audits that are noise on a localhost preview.
        skipAudits: ['canonical', 'is-on-https', 'redirects-http'],
        chromeFlags: '--no-sandbox --headless=new',
      },
    },
    assert: {
      // Per-category floors — fail the gate if any category drops below.
      assertions: {
        'categories:performance': ['error', { minScore: 0.8 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
        'categories:seo': ['error', { minScore: 0.9 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
