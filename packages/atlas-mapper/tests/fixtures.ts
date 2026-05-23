/**
 * Test fixtures shared across atlas-mapper tests.
 *
 * Single source of truth for the small, hand-curated designs we use
 * to exercise determinism, mapping, and diff. The full prakash-tiwari
 * fixture lives in the `golden-prakash-tiwari.test.ts` golden test.
 *
 * # Design note: per-tree root tags
 *
 * The fingerprint algorithm uses `tag + role + parent-path + sibling-
 * position`. It does NOT include the `componentTreeId` in the
 * derivation — so two roots with the same `(tag, role, position=0)`
 * across trees would collide in the global uniqueness set. We avoid
 * that here by giving each page tree a distinct component-name root
 * (`HomePage`, `AboutPage`). In production this is also how adapters
 * keep trees disjoint — they emit page-level components rather than
 * raw `<div>`s, and the slugified names differ per page.
 */

import type {
  RenderableDesign,
  RenderableNode,
} from '../src/renderable-design.js';
import type { TicketNode } from '../src/ticket-tree.js';

/** The "home" page tree — small but representative. */
export function homeTree(): RenderableNode {
  return {
    tag: 'HomePage',
    role: 'page',
    attrs: { className: 'pt' },
    children: [
      { tag: 'PtNav', role: 'widget', attrs: { active: '/' } },
      {
        tag: 'HomeHeroSlider',
        role: 'widget',
        children: [
          { tag: 'div', role: 'leaf', attrs: { className: 'slide-1' } },
          { tag: 'div', role: 'leaf', attrs: { className: 'slide-2' } },
        ],
      },
      {
        tag: 'section',
        role: 'section',
        attrs: { className: 'pt-band-cool' },
        children: [
          { tag: 'h2', role: 'leaf', copyRefs: ['copy:home-headline'] },
          {
            tag: 'div',
            role: 'leaf',
            attrs: { className: 'grid' },
            children: [
              { tag: 'a', role: 'leaf', attrs: { 'data-go': '/about' } },
              { tag: 'a', role: 'leaf', attrs: { 'data-go': '/projects' } },
              { tag: 'a', role: 'leaf', attrs: { 'data-go': '/writing' } },
            ],
          },
        ],
      },
    ],
  };
}

/** The "about" page tree — distinct root tag to avoid root collision. */
export function aboutTree(): RenderableNode {
  return {
    tag: 'AboutPage',
    role: 'page',
    attrs: { className: 'pt about' },
    children: [
      { tag: 'PtNav', role: 'widget', attrs: { active: '/about' } },
      {
        tag: 'section',
        role: 'section',
        attrs: { className: 'pt-band-warm' },
        children: [{ tag: 'h1', role: 'leaf', copyRefs: ['copy:about-h1'] }],
      },
    ],
  };
}

/** A canonical small `RenderableDesign` for tests. */
export function smallDesign(designVersionId = 'dv_test_001'): RenderableDesign {
  return {
    designVersionId,
    source: 'cd-zip',
    routes: [
      { path: '/', componentTreeId: 'tree:home' },
      { path: '/about', componentTreeId: 'tree:about' },
    ],
    componentTrees: {
      'tree:home': { node: homeTree() },
      'tree:about': { node: aboutTree() },
    },
    copy: [
      { domId: 'copy:home-headline', text: 'The vocabulary I show up with.' },
      { domId: 'copy:about-h1', text: 'About me.' },
    ],
  };
}

/**
 * V2 of the small design — only style + copy changes. Every DOM-ID
 * should survive. Use for survival tests.
 */
export function smallDesignStyleOnly(designVersionId = 'dv_test_002'): RenderableDesign {
  const home = homeTree();
  home.attrs = { className: 'pt theme-dark' };

  return {
    designVersionId,
    source: 'cd-zip',
    routes: [
      { path: '/', componentTreeId: 'tree:home' },
      { path: '/about', componentTreeId: 'tree:about' },
    ],
    componentTrees: {
      'tree:home': { node: home },
      'tree:about': { node: aboutTree() },
    },
    copy: [
      { domId: 'copy:home-headline', text: 'Words I show up with.' },
      { domId: 'copy:about-h1', text: 'About me.' },
    ],
  };
}

/**
 * V3 of the small design — structural changes that should flip IDs:
 * one slide removed, one new anchor added.
 */
export function smallDesignStructural(designVersionId = 'dv_test_003'): RenderableDesign {
  return {
    designVersionId,
    source: 'cd-zip',
    routes: [
      { path: '/', componentTreeId: 'tree:home' },
      { path: '/about', componentTreeId: 'tree:about' },
    ],
    componentTrees: {
      'tree:home': {
        node: {
          tag: 'HomePage',
          role: 'page',
          attrs: { className: 'pt' },
          children: [
            { tag: 'PtNav', role: 'widget', attrs: { active: '/' } },
            {
              tag: 'HomeHeroSlider',
              role: 'widget',
              children: [
                // one slide removed (was slide-1 + slide-2; now only slide-1)
                { tag: 'div', role: 'leaf', attrs: { className: 'slide-1' } },
              ],
            },
            {
              tag: 'section',
              role: 'section',
              attrs: { className: 'pt-band-cool' },
              children: [
                { tag: 'h2', role: 'leaf', copyRefs: ['copy:home-headline'] },
                {
                  tag: 'div',
                  role: 'leaf',
                  attrs: { className: 'grid' },
                  children: [
                    { tag: 'a', role: 'leaf', attrs: { 'data-go': '/about' } },
                    { tag: 'a', role: 'leaf', attrs: { 'data-go': '/projects' } },
                    { tag: 'a', role: 'leaf', attrs: { 'data-go': '/writing' } },
                    { tag: 'a', role: 'leaf', attrs: { 'data-go': '/speaking' } },
                  ],
                },
              ],
            },
          ],
        },
      },
      'tree:about': { node: aboutTree() },
    },
    copy: [
      { domId: 'copy:home-headline', text: 'The vocabulary I show up with.' },
      { domId: 'copy:about-h1', text: 'About me.' },
    ],
  };
}

/**
 * Pre-computed derived DOM-IDs for the home tree.
 *
 * These are what `assignStableDomIds` will set on `homeTree()` —
 * tests reference them so they don't have to be re-derived
 * everywhere.
 */
export const HOME_DOM_IDS = {
  page: 'home-page:page:0',
  nav: 'home-page:page:0>pt-nav:widget:0',
  hero: 'home-page:page:0>home-hero-slider:widget:1',
  heroSlide1: 'home-page:page:0>home-hero-slider:widget:1>div:leaf:0',
  heroSlide2: 'home-page:page:0>home-hero-slider:widget:1>div:leaf:1',
  section: 'home-page:page:0>section:section:2',
  h2: 'home-page:page:0>section:section:2>h2:leaf:0',
  grid: 'home-page:page:0>section:section:2>div:leaf:1',
  link0: 'home-page:page:0>section:section:2>div:leaf:1>a:leaf:0',
  link1: 'home-page:page:0>section:section:2>div:leaf:1>a:leaf:1',
  link2: 'home-page:page:0>section:section:2>div:leaf:1>a:leaf:2',
} as const;

export const ABOUT_DOM_IDS = {
  page: 'about-page:page:0',
  nav: 'about-page:page:0>pt-nav:widget:0',
  section: 'about-page:page:0>section:section:1',
  h1: 'about-page:page:0>section:section:1>h1:leaf:0',
} as const;

/**
 * Ticket tree matching the canonical small design.
 *
 * Stories that span multiple DOM-IDs use `additionalDomIds`. The
 * `S-site` root has no DOM-ID (organisational).
 */
export function smallTicketTree(): TicketNode[] {
  return [
    {
      id: 'S-site',
      children: [
        {
          id: 'PG-home',
          domId: HOME_DOM_IDS.page,
          children: [
            { id: 'WD-home-nav', domId: HOME_DOM_IDS.nav },
            {
              id: 'WD-home-hero',
              domId: HOME_DOM_IDS.hero,
              children: [
                { id: 'WD-home-hero-slide-01', domId: HOME_DOM_IDS.heroSlide1 },
                { id: 'WD-home-hero-slide-02', domId: HOME_DOM_IDS.heroSlide2 },
              ],
            },
            {
              id: 'SE-home-cert-strip',
              domId: HOME_DOM_IDS.section,
              children: [
                {
                  id: 'ST-home-cert-row',
                  additionalDomIds: [
                    HOME_DOM_IDS.link0,
                    HOME_DOM_IDS.link1,
                    HOME_DOM_IDS.link2,
                  ],
                },
              ],
            },
          ],
        },
        {
          id: 'PG-about',
          domId: ABOUT_DOM_IDS.page,
          children: [
            { id: 'WD-about-nav', domId: ABOUT_DOM_IDS.nav },
            { id: 'SE-about-intro', domId: ABOUT_DOM_IDS.section },
          ],
        },
      ],
    },
  ];
}
