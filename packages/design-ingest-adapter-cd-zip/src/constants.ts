/**
 * Spec §2.1 — file enumerations the CD ZIP adapter must honour.
 *
 * `IGNORE_FILES` are prototype-shell files emitted by the Claude
 * Design renderer that don't correspond to user-facing routes. The
 * validator skips them; the JSX walker never sees them.
 *
 * `REQUIRED_FILES` are the three files whose absence is a p0
 * validation failure: without them, the bundle isn't a CD ZIP.
 */

export const IGNORE_FILES = Object.freeze([
  'prototype.html',
  'design-canvas.jsx',
  'browser-window.jsx',
  'tweaks-panel.jsx',
  'index.html',
  'mobile-pages.jsx',
  'style-guide.jsx',
  'sitemap.jsx',
] as const);

export const REQUIRED_FILES = Object.freeze([
  'README.md',
  'project/styles.css',
] as const);

/** Required file pattern: at least one JSX under project/pages/. */
export const REQUIRED_PAGE_PATTERN = /^project\/pages\/[^/]+\.jsx$/;
