/**
 * chiefaia-site Next.js config.
 *
 * Switched from `next.config.js` (CommonJS) to `.mjs` because the MDX
 * frontmatter pipeline depends on remark-frontmatter@5 and
 * remark-mdx-frontmatter@5, both of which are ESM-only.
 *
 * What's wired:
 *   - @next/mdx so .mdx files imported anywhere in the app compile to a React
 *     component
 *   - remark-frontmatter so `---` blocks at the top of an .mdx file are
 *     parsed (and NOT rendered as horizontal rules)
 *   - remark-mdx-frontmatter so the parsed frontmatter is re-exposed as a
 *     named `frontmatter` export on the .mdx module
 *
 * The legal pages at /legal/privacy, /legal/terms, /legal/aup are the first
 * consumers; ADR-066 records the override of PR #497 that re-enables a
 * Next.js scaffold for chiefaia.com.
 */

import createMDX from '@next/mdx';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  trailingSlash: false,
  env: {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || 'https://chiefaia.com',
  },
  transpilePackages: ['@caia/ui'],
  pageExtensions: ['ts', 'tsx'],
};

const withMDX = createMDX({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: [
      remarkFrontmatter,
      [remarkMdxFrontmatter, { name: 'frontmatter' }],
    ],
    rehypePlugins: [],
  },
});

export default withMDX(nextConfig);
