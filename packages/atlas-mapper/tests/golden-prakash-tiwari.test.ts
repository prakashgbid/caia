/**
 * Golden test against the prakash-tiwari CD-ZIP fixture.
 *
 * Fixture location:
 *   /Users/macbook32/Documents/projects/prakash-tiwari-com-design/
 *     extracted/prakash-tiwari-com/project/pages/*.jsx
 *
 * The fixture is real JSX from the canonical CAIA design source. We:
 *
 *   1. Parse 21 page files into a `RenderableDesign` using ts-morph
 *      via `parseJsxToRenderableDesign`.
 *   2. Run `assignStableDomIds` to assign fingerprint-derived IDs.
 *   3. Build the DOM-ID map.
 *   4. Assert non-trivial invariants:
 *      - every entry has a unique, non-empty DOM-ID
 *      - the page roots use the expected fingerprint shape
 *      - re-running over the same source yields byte-identical output
 *      - a synthetic "v2" with only style + copy changes preserves
 *        every ID (survival under restyling)
 *
 * The fixture lives OUTSIDE the caia repo so we read it from an
 * absolute path. If the fixture is unavailable on this machine, the
 * test self-skips — keeps the suite portable across CI nodes that
 * don't sync the personal projects folder.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { assignStableDomIds } from '../src/assign-stable-dom-ids.js';
import { buildDomIdMap } from '../src/dom-id-map.js';
import { buildMapper } from '../src/mapper.js';
import { diff } from '../src/diff.js';
import { parseJsxToRenderableDesign } from '../src/parse-jsx.js';
import type { RenderableDesign } from '../src/renderable-design.js';

const FIXTURE_ROOT =
  '/Users/macbook32/Documents/projects/prakash-tiwari-com-design/extracted/prakash-tiwari-com/project/pages';

const FIXTURE_AVAILABLE = existsSync(FIXTURE_ROOT);
const describeIfFixture = FIXTURE_AVAILABLE ? describe : describe.skip;

/**
 * Map a fixture filename to a `routePath`. The CD-ZIP uses filenames
 * like `home.jsx` → `/`, `about.jsx` → `/about`,
 * `caia-sections-b.jsx` → `/projects/caia-b` (heuristic).
 */
function fileToRoute(filename: string): string {
  const base = filename.replace(/\.jsx$/, '');
  if (base === 'home') return '/';
  return `/${base.replace(/\./g, '-')}`;
}

function loadFixtureFiles(): Array<{ filePath: string; source: string; routePath: string }> {
  const files = readdirSync(FIXTURE_ROOT)
    .filter((f) => f.endsWith('.jsx'))
    .sort();
  return files.map((f) => ({
    filePath: f,
    source: readFileSync(join(FIXTURE_ROOT, f), 'utf-8'),
    routePath: fileToRoute(f),
  }));
}

/**
 * Mutate a `RenderableDesign` in place to simulate style + copy
 * changes WITHOUT touching structure. Used to prove ID survival.
 */
function applyStyleAndCopyTweaks(rd: RenderableDesign): RenderableDesign {
  const cloned: RenderableDesign = JSON.parse(JSON.stringify(rd));
  // Bump every className that exists; flip every text by appending '!'.
  const visit = (n: { attrs?: Record<string, unknown>; children?: { tag: string }[] }): void => {
    if (n.attrs && typeof n.attrs.className === 'string') {
      n.attrs.className = `${n.attrs.className} pt-bumped`;
    }
    if (Array.isArray((n as { children?: unknown[] }).children)) {
      for (const c of (n as { children: { tag: string }[] }).children) {
        visit(c as never);
      }
    }
  };
  for (const treeId of Object.keys(cloned.componentTrees)) {
    const t = cloned.componentTrees[treeId];
    if (t) visit(t.node as never);
  }
  if (Array.isArray(cloned.copy)) {
    for (const c of cloned.copy) c.text = `${c.text}!`;
  }
  cloned.designVersionId = `${rd.designVersionId}-v2`;
  return cloned;
}

describeIfFixture('golden: prakash-tiwari CD-ZIP fixture', () => {
  it('lives at the expected absolute path', () => {
    expect(FIXTURE_AVAILABLE).toBe(true);
  });

  it('parses all 21 page JSX files into a RenderableDesign', () => {
    const files = loadFixtureFiles();
    expect(files.length).toBeGreaterThanOrEqual(20);
    const rd = parseJsxToRenderableDesign({
      designVersionId: 'dv_prakash_v1',
      files,
      source: 'cd-zip',
    });
    expect(rd.routes.length).toBe(files.length);
    expect(Object.keys(rd.componentTrees).length).toBe(files.length);
  });

  it('assigns stable, non-empty, unique DOM-IDs across the whole site', () => {
    const files = loadFixtureFiles();
    const rd = parseJsxToRenderableDesign({
      designVersionId: 'dv_prakash_v1',
      files,
      source: 'cd-zip',
    });
    const stabilised = assignStableDomIds(rd);
    const map = buildDomIdMap(stabilised);

    expect(map.entries.length).toBeGreaterThan(100);
    const seen = new Set<string>();
    for (const e of map.entries) {
      expect(e.domId).toBeTruthy();
      expect(seen.has(e.domId)).toBe(false);
      seen.add(e.domId);
    }
  });

  it('home tree root has the expected fingerprint shape', () => {
    const files = loadFixtureFiles();
    const rd = parseJsxToRenderableDesign({
      designVersionId: 'dv_prakash_v1',
      files,
      source: 'cd-zip',
    });
    const stabilised = assignStableDomIds(rd);
    // The JSX adapter pins each tree root's domId to a route-derived
    // slug so multi-page designs don't collide on identical root tags.
    // home.jsx is at route '/', mapped to componentTreeId 'tree:root',
    // so the pinned root domId is 'root:root'.
    const homeTree = stabilised.componentTrees['tree:root']!;
    expect(homeTree.node.domId).toBe('root:root');
  });

  it('re-running over the same source yields byte-identical output', () => {
    const files = loadFixtureFiles();
    const a = assignStableDomIds(
      parseJsxToRenderableDesign({ designVersionId: 'dv', files, source: 'cd-zip' }),
    );
    const b = assignStableDomIds(
      parseJsxToRenderableDesign({ designVersionId: 'dv', files, source: 'cd-zip' }),
    );
    // Tree-by-tree comparison; full JSON compare is huge but feasible.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('style + copy changes preserve every DOM-ID (survival)', () => {
    const files = loadFixtureFiles();
    const v1 = assignStableDomIds(
      parseJsxToRenderableDesign({ designVersionId: 'dv_v1', files, source: 'cd-zip' }),
    );
    const v2 = assignStableDomIds(applyStyleAndCopyTweaks(v1));
    const m1 = buildDomIdMap(v1);
    const m2 = buildDomIdMap(v2);

    // Every id from v1 survives into v2.
    for (const id of m1.byId.keys()) {
      expect(m2.byId.has(id)).toBe(true);
    }
    expect(m1.entries.length).toBe(m2.entries.length);

    // Diff confirms: zero structural change, but at least one
    // attrs_changed (className got bumped).
    const dr = diff(v1, v2);
    expect(dr.summary.added).toBe(0);
    expect(dr.summary.removed).toBe(0);
    expect(dr.summary.modified).toBeGreaterThan(0);
  });

  it('exposes a working mapper over the full fixture (smoke test)', () => {
    const files = loadFixtureFiles();
    const rd = parseJsxToRenderableDesign({
      designVersionId: 'dv_prakash_v1',
      files,
      source: 'cd-zip',
    });
    const stabilised = assignStableDomIds(rd);
    const map = buildDomIdMap(stabilised);

    // Bind one synthetic ticket to the home root + a child link.
    const homeRoot = stabilised.componentTrees['tree:root']!.node.domId!;
    const firstChildDomId =
      stabilised.componentTrees['tree:root']!.node.children?.[0]?.domId;
    const mapper = buildMapper(map, [
      {
        id: 'PG-home',
        domId: homeRoot,
        children: firstChildDomId
          ? [{ id: 'WD-home-some-widget', domId: firstChildDomId }]
          : [],
      },
    ]);
    expect(mapper.ticketByDomId(homeRoot)?.id).toBe('PG-home');
    expect(mapper.descendantTickets(homeRoot).length).toBeGreaterThanOrEqual(1);
  });
});
