/**
 * Storybook preview — shared decorators + parameters.
 *
 * The a11y addon runs axe-core against every story in the Storybook UI;
 * the Playwright `tests/e2e/axe.spec.ts` suite runs the same checks in
 * CI with `@axe-core/playwright` for hard pass/fail (spec §9.5).
 */

import type { Preview } from '@storybook/react';
import '../src/styles/atlas.css';

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: {
      config: {
        rules: [
          // Aspirational target: WCAG 2.2 AA. The addon ships 2.1 AA by default;
          // we enable the few 2.2-specific rules explicitly. WCAG-2.2-AAA rules
          // (e.g. focus-not-obscured) are surfaced as warnings only.
          { id: 'target-size', enabled: true },
        ],
      },
    },
    layout: 'fullscreen',
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#0b0f17' },
        { name: 'light', value: '#ffffff' },
      ],
    },
  },
};

export default preview;
