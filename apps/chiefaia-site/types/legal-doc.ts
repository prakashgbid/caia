/**
 * Shared types for legal documents (privacy / terms / aup).
 *
 * Kept here (a real .ts module) rather than inside `mdx.d.ts` (an ambient
 * .d.ts script file) so the interface can be imported normally by .tsx
 * consumers. The ambient mdx.d.ts file re-imports this type inside its
 * `declare module '*.mdx'` block to ensure `frontmatter` is typed
 * end-to-end.
 */

export interface LegalDocFrontmatter {
  title: string;
  slug: string;
  lastUpdated: string;
  effectiveDate: string;
  summary: string;
  counselReviewPending: boolean;
}
