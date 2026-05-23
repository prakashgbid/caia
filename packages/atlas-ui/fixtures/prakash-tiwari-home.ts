/**
 * Fixture data for the prakash-tiwari home page.
 *
 * Mirrors the spec's prakash-tiwari example (§3.1, §5.2, §10.2):
 * one Site → one Page → one Section (Hero) → one Widget (Rotator) →
 * two slides → stats-row story. Kept deliberately small (≈25
 * tickets) so tests are fast.
 */

import type {
  AtlasDesignVersion,
  AtlasLatestDesignResponse,
  AtlasSseEvent,
  AtlasTicketNode,
  AtlasTicketTree,
  AtlasTicketVersion,
  AtlasTicketVersionsResponse,
} from '../src/types/index.js';

export const PROJECT_ID = 'p_prakash_tiwari';
export const DESIGN_VERSION_ID = 'dv_prakash_tiwari_v1';
export const HERO_STATS_TICKET_ID = 'WD-home-hero-slide-01-stats';

export const ticketTree: AtlasTicketTree = {
  designVersionId: DESIGN_VERSION_ID,
  tree: {
    id: 'S-prakash-tiwari',
    level: 'site',
    title: 'prakash-tiwari.com',
    state: 'approved',
    domId: null,
    children: [
      { id: 'FN-tokens', level: 'foundation', title: 'Design tokens', state: 'approved', domId: null },
      {
        id: 'PG-home',
        level: 'page',
        title: '[/] Home',
        state: 'in-progress',
        domId: 'PG-home',
        ownerAgent: null,
        children: [
          {
            id: 'SE-home-nav',
            level: 'section',
            title: '[/] Home — Top nav',
            state: 'approved',
            domId: 'SE-home-nav',
            children: [
              { id: 'WD-home-nav-monogram', level: 'widget', title: 'Monogram', state: 'approved', domId: 'WD-home-nav-monogram' },
              { id: 'WD-home-nav-links', level: 'widget', title: 'Nav links', state: 'approved', domId: 'WD-home-nav-links' },
            ],
          },
          {
            id: 'SE-home-hero',
            level: 'section',
            title: '[/] Home — Hero carousel',
            state: 'change-requested',
            domId: 'SE-home-hero',
            ownerAgent: 'caia-frontend-architect',
            lastPromptAt: '2026-05-23T14:33:12Z',
            children: [
              {
                id: 'WD-home-hero-rotator',
                level: 'widget',
                title: 'Rotator',
                state: 'approved',
                domId: 'WD-home-hero-rotator',
                children: [
                  {
                    id: 'WD-home-hero-slide-01-caia',
                    level: 'widget',
                    title: 'Slide 01 — CAIA',
                    state: 'approved',
                    domId: 'WD-home-hero-slide-01-caia',
                    children: [
                      {
                        id: HERO_STATS_TICKET_ID,
                        level: 'story',
                        title: 'Stats row',
                        state: 'change-requested',
                        domId: HERO_STATS_TICKET_ID,
                        ownerAgent: 'caia-frontend-architect',
                        lastPromptAt: '2026-05-23T14:33:12Z',
                      },
                      {
                        id: 'ST-home-hero-slide-01-caia-cta',
                        level: 'story',
                        title: 'Primary CTA',
                        state: 'approved',
                        domId: 'ST-home-hero-slide-01-caia-cta',
                      },
                    ],
                  },
                  {
                    id: 'WD-home-hero-slide-02-pokerzeno',
                    level: 'widget',
                    title: 'Slide 02 — pokerzeno',
                    state: 'proposed',
                    domId: 'WD-home-hero-slide-02-pokerzeno',
                  },
                ],
              },
            ],
          },
          {
            id: 'SE-home-projects',
            level: 'section',
            title: '[/] Home — Featured projects',
            state: 'approved',
            domId: 'SE-home-projects',
            children: [
              { id: 'WD-home-projects-grid', level: 'widget', title: 'Projects grid', state: 'approved', domId: 'WD-home-projects-grid' },
            ],
          },
          { id: 'SE-home-worked-with', level: 'section', title: '[/] Home — Worked-with wall', state: 'orphaned', domId: 'SE-home-worked-with' },
        ],
      },
    ],
  },
};

export const latestDesign: AtlasDesignVersion = {
  id: DESIGN_VERSION_ID,
  uploadedAt: '2026-05-21T12:00:00Z',
  source: 'cd-zip',
  renderer: 'cd-zip',
  iframeUrl: 'about:blank',
  domIdManifestUrl: '/fixtures/prakash-tiwari/dom-id-manifest.json',
  thumbnails: { '/': '/fixtures/prakash-tiwari/thumb-home.webp' },
  routes: ['/'],
  defaultRoute: '/',
};

export const latestDesignResponse: AtlasLatestDesignResponse = {
  projectId: PROJECT_ID,
  designVersion: latestDesign,
};

const HISTORY_HERO_STATS: AtlasTicketVersion[] = [
  {
    id: 'tv_001',
    ticketId: HERO_STATS_TICKET_ID,
    designVersionId: DESIGN_VERSION_ID,
    versionNumber: 4,
    prompt: 'make the stats serif and 1.5× bigger',
    operatorUserId: 'u_demo',
    createdAt: '2026-05-23T14:33:12Z',
    previousState: 'approved',
    newState: 'change-requested',
    expectedChangeDescription:
      'Change typography of `.hero-stat-value` from sans-serif to var(--serif); scale font-size from 32px to 48px on desktop.',
    dispatchedTo: ['caia-frontend-architect'],
    resolvedAt: null,
    resolutionSummary: null,
    resolutionPrUrl: null,
  },
  {
    id: 'tv_002',
    ticketId: HERO_STATS_TICKET_ID,
    designVersionId: DESIGN_VERSION_ID,
    versionNumber: 3,
    prompt: 'remove the 3rd slide',
    operatorUserId: 'u_demo',
    createdAt: '2026-05-22T09:11:00Z',
    previousState: 'approved',
    newState: 'implemented',
    expectedChangeDescription: 'Remove the third hero rotator slide and renumber.',
    dispatchedTo: ['caia-frontend-architect'],
    resolvedAt: '2026-05-22T11:00:00Z',
    resolutionSummary: 'PR opened, merged.',
    resolutionPrUrl: 'https://example.com/pr/142',
  },
  {
    id: 'tv_003',
    ticketId: HERO_STATS_TICKET_ID,
    designVersionId: DESIGN_VERSION_ID,
    versionNumber: 2,
    prompt: 'shorten the CAIA tagline',
    operatorUserId: 'u_demo',
    createdAt: '2026-05-21T18:02:00Z',
    previousState: 'proposed',
    newState: 'implemented',
    expectedChangeDescription: 'Tighten the CAIA tagline to ≤ 10 words.',
    dispatchedTo: ['caia-frontend-architect'],
    resolvedAt: '2026-05-21T19:30:00Z',
    resolutionSummary: 'PR opened, merged.',
    resolutionPrUrl: 'https://example.com/pr/131',
  },
];

export const versionsByTicketId: Record<string, AtlasTicketVersionsResponse> = {
  [HERO_STATS_TICKET_ID]: {
    ticketId: HERO_STATS_TICKET_ID,
    versions: HISTORY_HERO_STATS,
    nextCursor: null,
  },
};

export const sampleEvents: AtlasSseEvent[] = [
  {
    type: 'agent.run-started',
    ticketId: HERO_STATS_TICKET_ID,
    agent: 'caia-frontend-architect',
    runId: 'r_001',
    ts: '2026-05-23T14:33:13Z',
  },
  {
    type: 'ticket.state-changed',
    ticketId: HERO_STATS_TICKET_ID,
    from: 'change-requested',
    to: 'in-progress',
    ts: '2026-05-23T14:33:14Z',
  },
  {
    type: 'agent.run-finished',
    ticketId: HERO_STATS_TICKET_ID,
    agent: 'caia-frontend-architect',
    runId: 'r_001',
    result: 'ok',
    prUrl: 'https://example.com/pr/143',
    ts: '2026-05-23T14:34:00Z',
  },
];

/**
 * Convert the ticket tree into the `TicketNode` shape accepted by
 * `buildMapper`. The mapper wants `id + domId + children + extra`.
 */
export function toMapperTickets(node: AtlasTicketNode): {
  id: string;
  domId?: string;
  children?: ReturnType<typeof toMapperTickets>[];
  extra: { level: string; title: string; state: string };
} {
  const child = Array.isArray(node.children) ? node.children.map(toMapperTickets) : undefined;
  const out: ReturnType<typeof toMapperTickets> = {
    id: node.id,
    extra: { level: node.level, title: node.title, state: node.state },
  };
  if (typeof node.domId === 'string') out.domId = node.domId;
  if (child) out.children = child;
  return out;
}

/**
 * A standalone `RenderableDesign` matching the ticket tree above.
 * Each tag-anchored node carries a `domId` so the mapper produces the
 * one-to-one binding. Only the fields atlas-mapper needs are populated.
 */
export const renderableDesign = {
  designVersionId: DESIGN_VERSION_ID,
  routes: [{ path: '/', componentTreeId: 'tree:home' }],
  componentTrees: {
    'tree:home': {
      node: {
        tag: 'main',
        role: 'page' as const,
        domId: 'PG-home',
        children: [
          {
            tag: 'nav',
            role: 'section' as const,
            domId: 'SE-home-nav',
            children: [
              { tag: 'a', role: 'leaf' as const, domId: 'WD-home-nav-monogram' },
              { tag: 'ul', role: 'leaf' as const, domId: 'WD-home-nav-links' },
            ],
          },
          {
            tag: 'section',
            role: 'section' as const,
            domId: 'SE-home-hero',
            children: [
              {
                tag: 'div',
                role: 'widget' as const,
                domId: 'WD-home-hero-rotator',
                children: [
                  {
                    tag: 'div',
                    role: 'widget' as const,
                    domId: 'WD-home-hero-slide-01-caia',
                    children: [
                      { tag: 'div', role: 'leaf' as const, domId: HERO_STATS_TICKET_ID },
                      { tag: 'a', role: 'leaf' as const, domId: 'ST-home-hero-slide-01-caia-cta' },
                    ],
                  },
                  { tag: 'div', role: 'widget' as const, domId: 'WD-home-hero-slide-02-pokerzeno' },
                ],
              },
            ],
          },
          {
            tag: 'section',
            role: 'section' as const,
            domId: 'SE-home-projects',
            children: [{ tag: 'div', role: 'widget' as const, domId: 'WD-home-projects-grid' }],
          },
          { tag: 'section', role: 'section' as const, domId: 'SE-home-worked-with' },
        ],
      },
    },
  },
};
