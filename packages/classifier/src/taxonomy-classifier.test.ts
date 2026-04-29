/**
 * BUCKET-002 — taxonomy classifier tests.
 *
 * Cover every public helper. The test bench doubles as the spec.
 */

import {
  classifyProject,
  classifyBusinessSubDomains,
  classifyLifecycle,
  classifyPriority,
} from './taxonomy-classifier';

// ─── classifyProject ────────────────────────────────────────────────────────

describe('classifyProject', () => {
  it('returns unassigned with confidence 0 when nothing matches', () => {
    const r = classifyProject('completely unrelated text');
    expect(r.slug).toBe('unassigned');
    expect(r.confidence).toBe(0);
    expect(r.matches).toEqual([]);
  });

  it('matches pokerzeno over generic platform terms', () => {
    const r = classifyProject('Build the pokerzeno gameplay engine using the orchestrator');
    expect(r.slug).toBe('pokerzeno');
  });

  it('matches roulettecommunity', () => {
    const r = classifyProject('Add a forum to roulette community for advisor discussions');
    expect(r.slug).toBe('roulettecommunity');
  });

  it('matches edisoncricket', () => {
    expect(classifyProject('add live coverage to edison cricket').slug).toBe('edisoncricket');
  });

  it('matches the platform itself when prompt mentions orchestrator/dashboard', () => {
    expect(classifyProject('extend the orchestrator dashboard pipeline').slug).toBe('caia');
  });

  it('matches plugin packages by exact slug', () => {
    expect(classifyProject('release the dev-inspector plugin v2').slug).toBe('dev-inspector');
    expect(classifyProject('image-provider needs an R2 backend').slug).toBe('image-provider');
  });

  it('matches personal sites', () => {
    expect(classifyProject('redesign ankita tiwari portfolio').slug).toBe('ankitatiwari');
    expect(classifyProject('prakash personal blog migration').slug).toBe('prakash-tiwari');
  });

  it('matches chiefaia.com when explicitly mentioned', () => {
    expect(classifyProject('build the chiefaia.com pricing page').slug).toBe('chiefaia.com');
  });

  it('reports all match candidates for audit', () => {
    const r = classifyProject('add a poker zeno gameplay screen and roulette community profile');
    expect(r.matches.length).toBeGreaterThanOrEqual(2);
    expect(r.matches.map((m) => m.slug)).toContain('pokerzeno');
    expect(r.matches.map((m) => m.slug)).toContain('roulettecommunity');
  });

  it('confidence is in [0,1]', () => {
    const r = classifyProject('pokerzeno pokerzeno pokerzeno');
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });
});

// ─── classifyBusinessSubDomains ─────────────────────────────────────────────

describe('classifyBusinessSubDomains', () => {
  it('returns [] when project is unknown', () => {
    expect(classifyBusinessSubDomains('any text', 'unknown-project')).toEqual([]);
  });

  it('returns [] when no keywords match', () => {
    expect(classifyBusinessSubDomains('lorem ipsum dolor sit amet', 'pokerzeno')).toEqual([]);
  });

  it('matches pokerzeno billing + profile when both keywords present', () => {
    const r = classifyBusinessSubDomains('add a billing tab to the user profile', 'pokerzeno');
    expect(r).toContain('billing');
    expect(r).toContain('profile');
  });

  it('caps results at 4 by default', () => {
    const r = classifyBusinessSubDomains(
      'gameplay hand deal seat table leaderboard ranking subscription invoice profile review',
      'pokerzeno',
    );
    expect(r.length).toBeLessThanOrEqual(4);
  });

  it('respects an explicit cap', () => {
    const r = classifyBusinessSubDomains(
      'gameplay leaderboard profile billing notification campaign',
      'pokerzeno',
      2,
    );
    expect(r.length).toBe(2);
  });

  it('orders by score (most matches first)', () => {
    const r = classifyBusinessSubDomains(
      // billing has 2 hits; gameplay has 1 hit
      'billing invoice gameplay',
      'pokerzeno',
    );
    expect(r[0]).toBe('billing');
  });

  it('handles caia sub-domains', () => {
    const r = classifyBusinessSubDomains(
      'wire the orchestrator dashboard for the bucket-placer pipeline',
      'caia',
    );
    expect(r).toContain('orchestration');
    expect(r).toContain('dashboard');
    expect(r).toContain('pipeline');
  });
});

// ─── classifyLifecycle ──────────────────────────────────────────────────────

describe('classifyLifecycle', () => {
  it('defaults to new when nothing matches', () => {
    expect(classifyLifecycle('lorem ipsum sit amet')).toBe('new');
  });

  it('detects hotfix', () => {
    expect(classifyLifecycle('hotfix the production-down billing endpoint')).toBe('hotfix');
  });

  it('detects bug', () => {
    expect(classifyLifecycle('the login flow is broken on mobile')).toBe('bug');
  });

  it('hotfix outranks bug', () => {
    expect(classifyLifecycle('hotfix the broken billing endpoint')).toBe('hotfix');
  });

  it('detects refactor', () => {
    expect(classifyLifecycle('refactor the bucket-placer module')).toBe('refactor');
  });

  it('detects chore', () => {
    expect(classifyLifecycle('chore: bump dependency version')).toBe('chore');
  });

  it('detects docs', () => {
    expect(classifyLifecycle('document the new pipeline in the readme')).toBe('docs');
  });

  it('detects spike', () => {
    expect(classifyLifecycle('spike on Dilworth chain cover')).toBe('spike');
  });

  it('detects enhance', () => {
    expect(classifyLifecycle('improve dashboard rendering performance')).toBe('enhance');
  });

  it('detects new for build/create/add', () => {
    expect(classifyLifecycle('add a billing panel')).toBe('new');
    expect(classifyLifecycle('create a new bucket placer')).toBe('new');
    expect(classifyLifecycle('build the leaderboard service')).toBe('new');
  });
});

// ─── classifyPriority ───────────────────────────────────────────────────────

describe('classifyPriority', () => {
  it('defaults to P2', () => {
    expect(classifyPriority('add a feature')).toBe('P2');
  });

  it('detects P0 from explicit P0', () => {
    expect(classifyPriority('P0: production is down')).toBe('P0');
  });

  it('detects P0 from urgency keywords', () => {
    expect(classifyPriority('urgent: drop everything')).toBe('P0');
  });

  it('detects P1', () => {
    expect(classifyPriority('this week we need this')).toBe('P1');
  });

  it('detects P3', () => {
    expect(classifyPriority('nice to have eventually')).toBe('P3');
  });

  it('P0 outranks P1', () => {
    expect(classifyPriority('urgent and high priority this week')).toBe('P0');
  });
});

// ─── enum-sync invariants — guard against drift from ticket-template ───────
// The classifier returns plain strings rather than typed enums to keep the
// package free of cross-monorepo deps. The PO Agent integration test
// (`bucket-006-multi-bucket-e2e`) is the cross-package sync gate; the local
// invariant here is just that the slug set is closed under the shape we promise.

describe('classifier slug invariants', () => {
  it('classifyProject only returns slugs from a known set', () => {
    const known = new Set([
      'caia',
      'pokerzeno',
      'roulettecommunity',
      'edisoncricket',
      'ankitatiwari',
      'prakash-tiwari',
      'chiefaia.com',
      'framework',
      'site-template',
      'image-provider',
      'cast-bridge',
      'dev-inspector',
      'backend-core',
      'content-engine',
      'integrity-check',
      'seo-program',
      'analytics',
      'unassigned',
    ]);
    const samples = [
      'pokerzeno gameplay',
      'roulette community forum',
      'edison cricket scores',
      'ankita tiwari blog',
      'prakash tiwari portfolio',
      'chiefaia.com pricing',
      'framework example',
      'site-template scaffold',
      'dev-inspector plugin',
      'image-provider api',
      'cast-bridge fix',
      'backend-core update',
      'content-engine renderer',
      'integrity-check tweak',
      'seo-program audit',
      'analytics package readme',
      'orchestrator dashboard caia',
      'lorem ipsum dolor',
    ];
    for (const s of samples) expect(known.has(classifyProject(s).slug)).toBe(true);
  });

  it('classifyLifecycle only returns slugs from a known set', () => {
    const known = new Set(['new', 'enhance', 'bug', 'refactor', 'chore', 'docs', 'hotfix', 'spike']);
    for (const s of [
      'add',
      'improve',
      'bug',
      'refactor',
      'chore',
      'document',
      'hotfix',
      'spike research',
      'lorem',
    ]) {
      expect(known.has(classifyLifecycle(s))).toBe(true);
    }
  });

  it('classifyPriority only returns P0 / P1 / P2 / P3', () => {
    const known = new Set(['P0', 'P1', 'P2', 'P3']);
    for (const s of ['urgent', 'this week', 'nice to have', 'something']) {
      expect(known.has(classifyPriority(s))).toBe(true);
    }
  });
});
