/**
 * Test fixtures — RenderableDesign skeletons used across the unit suite.
 *
 * Every fixture is intentionally small so assertions stay readable. The
 * integration suite uses larger real-world payloads from the
 * prakash-tiwari extracted ZIP.
 */

import type { RenderableDesign } from '@chiefaia/atlas-mapper';

export function baseDesign(): RenderableDesign {
  return {
    designVersionId: 'fixture-v1',
    source: 'cd-zip',
    routes: [
      {
        path: '/',
        title: 'Home',
        componentTreeId: 'tree:home',
        breakpoints: ['desktop', 'mobile'],
      },
    ],
    componentTrees: {
      'tree:home': {
        rootDomId: 'page-home',
        node: {
          domId: 'page-home',
          tag: 'main',
          role: 'page',
          children: [
            {
              domId: 'page-home>section-hero',
              tag: 'section',
              role: 'section',
              attrs: { className: 'pt-band-cool' },
              children: [
                {
                  domId: 'page-home>section-hero>widget-headline',
                  tag: 'h1',
                  role: 'widget',
                  attrs: { className: 'pt-h1' },
                  copyRefs: ['page-home>section-hero>widget-headline>copy-0'],
                },
                {
                  domId: 'page-home>section-hero>widget-cta-button',
                  tag: 'a',
                  role: 'widget',
                  attrs: { href: '/contact', className: 'pt-cta' },
                  copyRefs: ['page-home>section-hero>widget-cta-button>copy-0'],
                  interactivityRefs: ['page-home>section-hero>widget-cta-button'],
                },
              ],
            },
          ],
        },
      },
    },
    designTokens: {
      colors: { '--ink': '#1e2a35', '--paper': '#e8efe5', '--accent': '#3d6c95' },
      fonts: { '--serif': 'Source Serif Pro', '--sans': 'Inter' },
    },
    copy: [
      {
        domId: 'page-home>section-hero>widget-headline>copy-0',
        text: 'Building CAIA',
      },
      {
        domId: 'page-home>section-hero>widget-cta-button>copy-0',
        text: 'Contact me',
      },
    ],
    assets: [
      {
        path: '/headshot.jpg',
        kind: 'image',
        contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        byteSize: 184320,
        intrinsicSize: { w: 1200, h: 1200 },
        storageUrl: 'mem://upstream/headshot',
        alt: 'Headshot',
        isPlaceholder: false,
      },
    ],
    interactivity: [
      {
        domId: 'page-home>section-hero>widget-cta-button',
        kind: 'link',
        target: '/contact',
        ariaLabel: 'Get in touch',
      },
    ],
  };
}

/** Variant: copy text changed. */
export function copyChangedDesign(): RenderableDesign {
  const d = baseDesign();
  d.copy = [
    {
      domId: 'page-home>section-hero>widget-headline>copy-0',
      text: 'Building CAIA (now with vibes)',
    },
    {
      domId: 'page-home>section-hero>widget-cta-button>copy-0',
      text: 'Contact me',
    },
  ];
  return d;
}

/** Variant: a new widget added to the hero. */
export function nodeAddedDesign(): RenderableDesign {
  const d = baseDesign();
  d.componentTrees['tree:home']!.node.children!.push({
    domId: 'page-home>section-stats',
    tag: 'section',
    role: 'section',
    attrs: { className: 'pt-band-warm' },
    children: [
      {
        domId: 'page-home>section-stats>widget-counter',
        tag: 'div',
        role: 'widget',
        attrs: { className: 'pt-counter' },
        copyRefs: ['page-home>section-stats>widget-counter>copy-0'],
      },
    ],
  });
  d.copy!.push({
    domId: 'page-home>section-stats>widget-counter>copy-0',
    text: '25 years',
  });
  return d;
}

/** Variant: an existing node moved under a new parent. */
export function nodeMovedDesign(): RenderableDesign {
  const d = baseDesign();
  // Move the CTA button out of the hero and into a new "footer-cta" section.
  d.componentTrees['tree:home']!.node.children!.push({
    domId: 'page-home>section-footer-cta',
    tag: 'section',
    role: 'section',
    children: [
      {
        domId: 'page-home>section-hero>widget-cta-button',
        tag: 'a',
        role: 'widget',
        attrs: { href: '/contact', className: 'pt-cta' },
        copyRefs: ['page-home>section-hero>widget-cta-button>copy-0'],
        interactivityRefs: ['page-home>section-hero>widget-cta-button'],
      },
    ],
  });
  // Remove it from the hero.
  const hero = d.componentTrees['tree:home']!.node.children![0]!;
  hero.children = hero.children!.filter(
    (c) => c.domId !== 'page-home>section-hero>widget-cta-button',
  );
  return d;
}

/** Variant: a token value changed. */
export function tokenChangedDesign(): RenderableDesign {
  const d = baseDesign();
  d.designTokens = {
    ...d.designTokens,
    colors: { ...d.designTokens!.colors, '--accent': '#2a5680' },
  };
  return d;
}

/** Variant: an asset's content hash changed. */
export function assetHashChangedDesign(): RenderableDesign {
  const d = baseDesign();
  d.assets = [
    {
      ...d.assets![0]!,
      contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
  ];
  return d;
}

/** Variant: an asset removed entirely. */
export function assetRemovedDesign(): RenderableDesign {
  const d = baseDesign();
  d.assets = [];
  return d;
}

/** Variant: props (className) changed on a node. */
export function propsChangedDesign(): RenderableDesign {
  const d = baseDesign();
  const hero = d.componentTrees['tree:home']!.node.children![0]!;
  hero.attrs = { className: 'pt-band-warm' };
  return d;
}

/** Variant: interactivity added. */
export function interactivityAddedDesign(): RenderableDesign {
  const d = baseDesign();
  d.interactivity!.push({
    domId: 'page-home>section-hero>widget-headline',
    kind: 'button',
    ariaLabel: 'Toggle headline',
  });
  return d;
}
