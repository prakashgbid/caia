/**
 * Ambient TypeScript declaration for .mdx imports.
 *
 * MUST remain a script (no top-level imports/exports) so the
 * `declare module '*.mdx'` wildcard is a global ambient declaration rather
 * than module augmentation. The shared `LegalDocFrontmatter` interface
 * lives in `./legal-doc.ts` and is referenced from inside the block.
 *
 * Maps every `*.mdx` import to:
 *   - default export: the compiled React component
 *   - `frontmatter` named export: parsed YAML frontmatter, typed as
 *     LegalDocFrontmatter (sufficient for the current legal-pages
 *     consumer; widen to a generic shape if other MDX content lands
 *     with different keys)
 */

declare module '*.mdx' {
  import type { ComponentType } from 'react';
  import type { LegalDocFrontmatter } from './legal-doc';

  export const frontmatter: LegalDocFrontmatter;
  const MDXComponent: ComponentType<Record<string, unknown>>;
  export default MDXComponent;
}
