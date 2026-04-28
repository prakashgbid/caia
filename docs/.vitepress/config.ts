import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'CAIA',
  description: 'Chief AI Agent — foundational utilities for AI-driven application development',
  // Legacy archive folders preserved for capability-loss compliance are reference-only
  // and not part of the active VitePress build. They use foreign frontmatter shapes
  // (e.g. Docusaurus `sidebar_position`) and source assets (.tsx pages, vendor configs)
  // that don't belong in this site.
  srcExclude: ['legacy-roulette-advisor-ai/**'],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'Packages', link: '/packages/' },
      { text: 'GitHub', link: 'https://github.com/prakashgbid/caia' },
    ],
    sidebar: {
      '/guide/': [
        { text: 'Introduction', link: '/guide/' },
        { text: 'Getting Started', link: '/guide/getting-started' },
        { text: 'Architecture', link: '/guide/architecture' },
      ],
      '/packages/': [
        {
          text: 'Tier 1 — Infrastructure',
          items: [
            { text: 'logger', link: '/packages/logger' },
            { text: 'events', link: '/packages/events' },
            { text: 'metrics', link: '/packages/metrics' },
            { text: 'tracing', link: '/packages/tracing' },
            { text: 'errors', link: '/packages/errors' },
            { text: 'config', link: '/packages/config' },
            { text: 'secrets', link: '/packages/secrets' },
            { text: 'test-kit', link: '/packages/test-kit' },
          ],
        },
        {
          text: 'CLI',
          items: [{ text: '@chiefaia/cli', link: '/packages/cli' }],
        },
        {
          text: 'Shared Configs',
          items: [
            { text: 'eslint-config', link: '/packages/eslint-config' },
            { text: 'tsconfig', link: '/packages/tsconfig' },
            { text: 'vitest-config', link: '/packages/vitest-config' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/prakashgbid/caia' }],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Prakash Tiwari',
    },
  },
});
