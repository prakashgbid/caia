/**
 * Storybook v8 main config.
 *
 * Stories live under `stories/`, co-located by component. Each component
 * has one stories file with one story per interaction state (spec §10.1).
 *
 * The Vite framework is used directly (not Next.js) — Atlas-UI is a
 * library package; we don't need server components in the stories.
 */

import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.@(ts|tsx)'],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-interactions',
    '@storybook/addon-a11y',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  typescript: {
    check: false,
    reactDocgen: 'react-docgen-typescript',
  },
  docs: {},
};

export default config;
