/**
 * AST-shape fingerprinting — the heart of stable DOM-ID assignment.
 *
 * # The fingerprint contract (atlas spec §2.3)
 *
 * The fingerprint of a node is built from STRUCTURAL inputs only:
 *
 *     fingerprint(node) = `${tag-slug}:${role}:${sibling-position}`
 *     fullPath(node)    = parents.fingerprint.join('>') + node.fingerprint
 *
 * Crucially, the fingerprint does NOT include:
 *
 *   - `className`, inline `style`, or any other entry of `attrs`
 *   - inner text or copyRefs
 *   - asset refs, resolved styles, or design tokens
 *   - bounds / screenshots
 *
 * Consequence: a node keeps its DOM-ID when the operator restyles it,
 * rewords its copy, or swaps an image. The ID flips ONLY when the
 * structure changes — different tag, different role, different parent
 * path, or different sibling position. That is the "structural-move
 * → new ID" rule from spec §2.3, and it is what makes Atlas's
 * across-revision diff honest.
 *
 * # Slugification
 *
 *   `<HomeHeroSlider>`  → `home-hero-slider`
 *   `section`           → `section`
 *   empty / undefined   → `unknown`
 *
 * The slug rule is the same one ux-to-tickets uses for component
 * names, so a JSX-derived `<WorkedWithWall>` and a designer-renamed
 * `<LogoWall>` produce different fingerprints — which is the honest
 * outcome (renames surface as `removed + added`, spec §2.3).
 */

import type { NodeRole } from './renderable-design.js';

/**
 * Slugify a tag or component name into the fingerprint-safe form.
 *
 * Rules (in order):
 *   1. Strip surrounding angle brackets (JSX stringifications like
 *      `<HomeHero>` arrive that way from some adapters).
 *   2. PascalCase / camelCase → kebab-case.
 *   3. Collapse non-alphanumerics to single hyphens.
 *   4. Trim leading/trailing hyphens; substitute `unknown` for empty.
 */
export function slugifyTag(tag: string | undefined | null): string {
  if (!tag) return 'unknown';
  const stripped = String(tag).replace(/^<+|>+$/g, '').trim();
  if (stripped.length === 0) return 'unknown';
  const kebabed = stripped
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
  const cleaned = kebabed
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned.length > 0 ? cleaned : 'unknown';
}

/**
 * Produce the structural fingerprint segment for ONE node, given its
 * tag, role, and sibling position. Does not include parent context —
 * call `composeDomId` to chain segments.
 *
 * The format is `${tag-slug}:${role}:${position}`. The role is part
 * of the fingerprint because two `<div>`s with different `role`
 * (e.g. a `section` div vs a `widget` div) ARE different elements
 * structurally per the §1.1 taxonomy. The position is part because
 * sibling reorders are structural moves per §2.3.
 */
export function nodeFingerprint(
  tag: string | undefined,
  role: NodeRole,
  position: number,
): string {
  return `${slugifyTag(tag)}:${role}:${position}`;
}

/**
 * Chain a node fingerprint onto a parent DOM-ID. For roots, the
 * parent is `null` and the result is just the segment itself; for
 * non-roots, segments are joined with `>` so the full DOM-ID encodes
 * the ancestry path.
 *
 *   composeDomId('home:page:0', 'hero:section:0')   →
 *     'home:page:0>hero:section:0'
 *
 *   composeDomId(null, 'home:page:0')                →
 *     'home:page:0'
 */
export function composeDomId(parentDomId: string | null, segment: string): string {
  return parentDomId === null ? segment : `${parentDomId}>${segment}`;
}
