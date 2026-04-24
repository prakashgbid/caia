'use strict';

/** @returns {import('vitest/config').UserConfig} */
function defineConfig(overrides = {}) {
  return {
    test: {
      globals: true,
      environment: 'node',
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
        // Enforce 100% coverage delta on touched files
        thresholds: {
          perFile: true,
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
      },
      ...overrides.test,
    },
    ...overrides,
  };
}

module.exports = { defineConfig };
