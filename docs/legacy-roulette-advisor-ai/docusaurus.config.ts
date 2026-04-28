import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Roulette Advisor AI',
  tagline: 'Advanced betting analytics and recommendations',
  favicon: 'img/favicon.ico',
  url: 'https://your-domain.com',
  baseUrl: '/',
  organizationName: 'your-org',
  projectName: 'roulette-advisor-ai',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/your-org/roulette-advisor-ai/tree/main/packages/docs/',
        },
        blog: {
          showReadingTime: true,
          editUrl:
            'https://github.com/your-org/roulette-advisor-ai/tree/main/packages/docs/',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: 'img/docusaurus-social-card.jpg',
    navbar: {
      title: 'Roulette Advisor AI',
      logo: {
        alt: 'Roulette Advisor Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {to: '/blog', label: 'Blog', position: 'left'},
        {
          href: 'https://github.com/your-org/roulette-advisor-ai',
          label: 'GitHub',
          position: 'right',
        },
        {
          to: '/api',
          label: 'API',
          position: 'left'
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/intro',
            },
            {
              label: 'API Reference',
              to: '/api',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'Stack Overflow',
              href: 'https://stackoverflow.com/questions/tagged/roulette-advisor-ai',
            },
            {
              label: 'Discord',
              href: 'https://discord.gg/your-discord',
            },
            {
              label: 'Twitter',
              href: 'https://twitter.com/your-twitter',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Blog',
              to: '/blog',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/your-org/roulette-advisor-ai',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Roulette Advisor AI. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
