// apps/chiefaia-site/lighthouserc.cjs
//
// Lighthouse CI for the marketing site. Boots `next start -p 7878` and
// audits the canonical routes. Thresholds match the operator's mandate
// from the task brief — performance / accessibility / best-practices / seo
// must all clear 0.90.

module.exports = {
  ci: {
    collect: {
      startServerCommand: 'pnpm --filter @caia-app/chiefaia-site start',
      startServerReadyPattern: 'started server on',
      startServerReadyTimeout: 60000,
      url: [
        'http://localhost:7878/',
        'http://localhost:7878/pricing',
        'http://localhost:7878/docs',
        'http://localhost:7878/blog',
        'http://localhost:7878/changelog',
        'http://localhost:7878/contact',
      ],
      numberOfRuns: 1,
      settings: {
        preset: 'desktop',
        skipAudits: ['canonical', 'is-on-https', 'redirects-http'],
        chromeFlags: '--no-sandbox --headless=new',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
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
