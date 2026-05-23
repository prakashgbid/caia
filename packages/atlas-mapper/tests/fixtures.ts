/**
 * Reusable fixture builders for atlas-mapper tests.
 *
 * Keeping these in one file (and importing into every test file) gives
 * us deterministic, named building blocks that exercises tests can
 * assemble. Each builder returns a fresh deep clone so mutations in
 * one test never bleed into another.
 */

import type {
  RenderableDesign,
  RenderableNode,
  TicketNode,
} from '../src/index.js';

/** Build a leaf node with optional adapter-supplied domId. */
export function leaf(
  tag: string,
  opts: Partial<RenderableNode> = {},
): RenderableNode {
  return {
    tag,
    role: opts.role ?? 'leaf',
    ...(opts.domId !== undefined ? { domId: opts.domId } : {}),
    ...(opts.attrs !== undefined ? { attrs: { ...opts.attrs } } : {}),
    ...(opts.copyRefs !== undefined ? { copyRefs: [...opts.copyRefs] } : {}),
    ...(opts.assetRefs !== undefined ? { assetRefs: [...opts.assetRefs] } : {}),
    ...(opts.resolvedStyle !== undefined
      ? { resolvedStyle: { ...opts.resolvedStyle } }
      : {}),
    ...(opts.bounds !== undefined ? { bounds: { ...opts.bounds } } : {}),
    ...(opts.children !== undefined ? { children: [...opts.children] } : {}),
  };
}

/** Build a container node. */
export function container(
  tag: string,
  role: RenderableNode['role'],
  children: RenderableNode[],
  opts: Partial<RenderableNode> = {},
): RenderableNode {
  return leaf(tag, { ...opts, role, children });
}

/**
 * The canonical "simple home page" fixture used across most tests.
 *
 *   PG-home (section: page)
 *     SE-home-hero (section: section)
 *       WD-home-hero-rotator (section: widget)
 *         leaf cta-button
 *         leaf headline (with copyRef + style)
 *       leaf image (with assetRef)
 *     SE-home-footer (section: section)
 *       leaf copyright (with copyRef)
 */
export function simpleHomeDesign(
  overrides: Partial<RenderableDesign> = {},
): RenderableDesign {
  const home: RenderableNode = container(
    'main',
    'page',
    [
      container(
        'section',
        'section',
        [
          container(
            'div',
            'widget',
            [
              leaf('button', {
                domId: 'WD-home-hero-cta',
                role: 'leaf',
                attrs: { href: '/contact', className: 'pt-card-i' },
                copyRefs: ['copy:cta-text'],
              }),
              leaf('h1', {
                domId: 'WD-home-hero-headline',
                role: 'leaf',
                attrs: { className: 'pt-hero-headline' },
                copyRefs: ['copy:headline'],
                resolvedStyle: { fontFamily: 'Source Serif Pro', color: '#1e2a35' },
              }),
            ],
            {
              domId: 'WD-home-hero-rotator',
              attrs: { className: 'rotator' },
            },
          ),
          leaf('img', {
            domId: 'WD-home-hero-image',
            attrs: { alt: 'headshot' },
            assetRefs: ['/headshot.jpg'],
          }),
        ],
        {
          domId: 'SE-home-hero',
          attrs: { className: 'pt-band-cool' },
        },
      ),
      container(
        'section',
        'section',
        [
          leaf('p', {
            domId: 'WD-home-footer-copyright',
            copyRefs: ['copy:copyright'],
          }),
        ],
        {
          domId: 'SE-home-footer',
          attrs: { className: 'pt-band-warm' },
        },
      ),
    ],
    {
      domId: 'PG-home',
      attrs: { className: 'page page-home' },
    },
  );

  return {
    designVersionId: overrides.designVersionId ?? 'dv_simple_home_v1',
    source: 'cd-zip',
    routes: [{ path: '/', componentTreeId: 'tree:home' }],
    componentTrees: {
      'tree:home': { rootDomId: 'PG-home', node: home },
    },
    copy: [
      { domId: 'copy:cta-text', text: 'Get in touch', locale: 'en-US' },
      { domId: 'copy:headline', text: 'Building CAIA', locale: 'en-US' },
      { domId: 'copy:copyright', text: '© 2026', locale: 'en-US' },
    ],
    assets: [
      {
        path: '/headshot.jpg',
        kind: 'image',
        alt: 'headshot',
        contentHash: 'sha256:headshot-v1',
        storageUrl: 's3://t/headshot-v1.jpg',
      },
    ],
    ...overrides,
  };
}

/** Build the matching ticket tree for the simple home design. */
export function simpleHomeTickets(): TicketNode[] {
  return [
    {
      id: 'PG-home',
      domId: 'PG-home',
      children: [
        {
          id: 'SE-home-hero',
          domId: 'SE-home-hero',
          children: [
            {
              id: 'WD-home-hero-rotator',
              domId: 'WD-home-hero-rotator',
              children: [
                { id: 'WD-home-hero-cta', domId: 'WD-home-hero-cta' },
                { id: 'WD-home-hero-headline', domId: 'WD-home-hero-headline' },
              ],
            },
            { id: 'WD-home-hero-image', domId: 'WD-home-hero-image' },
          ],
        },
        {
          id: 'SE-home-footer',
          domId: 'SE-home-footer',
          children: [
            { id: 'WD-home-footer-copyright', domId: 'WD-home-footer-copyright' },
          ],
        },
      ],
    },
  ];
}

/**
 * Build a v2 of the simple home design with the modifications below.
 * Tests pass per-reason flags to scope which mutation to apply.
 */
export interface ModifyV2Opts {
  attrs?: boolean;
  copy?: boolean;
  asset?: boolean;
  token?: boolean;
  addNew?: boolean;
  removeOne?: boolean;
  positionShift?: boolean;
}

export function modifyHomeForV2(opts: ModifyV2Opts = {}): RenderableDesign {
  const d = simpleHomeDesign({ designVersionId: 'dv_simple_home_v2' });

  const tree = d.componentTrees['tree:home']!.node;
  const heroSection = tree.children![0]!;
  const rotator = heroSection.children![0]!;
  const cta = rotator.children![0]!;
  const headline = rotator.children![1]!;
  const heroImage = heroSection.children![1]!;

  if (opts.attrs) {
    // Bump the CTA's href + class — these are attrs_changed.
    cta.attrs = { ...(cta.attrs ?? {}), href: '/contact?ref=v2', className: 'pt-card-ii' };
  }

  if (opts.copy && Array.isArray(d.copy)) {
    // Modify the headline copy text — copy_changed (refs same, text differs).
    d.copy = d.copy.map((c) =>
      c.domId === 'copy:headline' ? { ...c, text: 'Shipping CAIA' } : c,
    );
  }

  if (opts.asset && Array.isArray(d.assets)) {
    // Rotate the headshot asset content-hash — asset_changed.
    d.assets = d.assets.map((a) =>
      a.path === '/headshot.jpg'
        ? { ...a, contentHash: 'sha256:headshot-v2', storageUrl: 's3://t/headshot-v2.jpg' }
        : a,
    );
  }

  if (opts.token) {
    // Change resolvedStyle on the headline but keep attrs identical —
    // token_changed.
    headline.resolvedStyle = { fontFamily: 'Source Serif Pro', color: '#000000' };
  }

  if (opts.addNew) {
    // Append a new widget under the hero section. Adapter-supplied id
    // so the addition shows up cleanly even though there's a sibling
    // already at position 2.
    heroSection.children!.push(
      leaf('span', {
        domId: 'WD-home-hero-badge',
        attrs: { className: 'badge' },
      }),
    );
  }

  if (opts.removeOne) {
    // Drop the footer copyright. Both the SE node's child array and
    // any unbound-ticket fallout should be detected.
    const footer = tree.children![1]!;
    footer.children = [];
  }

  if (opts.positionShift) {
    // Swap CTA <-> headline order inside the rotator. Since both have
    // adapter-supplied IDs, the IDs survive but `position` shifts.
    rotator.children = [headline, cta];
  }

  if (opts.removeOne) {
    // Touch up: removing the only child of the footer leaves its
    // child empty; nothing else to do.
  }

  // mark useful unused-var fix
  void heroImage;

  return d;
}
