/**
 * chiefaia-site Next.js config.
 *
 * `output: 'standalone'` builds the minimal runtime tree at
 * `.next/standalone/` that the Docker image ships. The standalone
 * server starts via `node apps/chiefaia-site/server.js` and bundles
 * only the workspace deps actually traced from the route graph — this
 * is what keeps the final image small without us hand-rolling a node
 * install of the entire monorepo.
 *
 * Switched from `next.config.js` (CommonJS) to `.mjs` because the MDX
 * frontmatter pipeline depends on remark-frontmatter@5 and
 * remark-mdx-frontmatter@5, both of which are ESM-only.
 *
 * What's wired:
 *   - @next/mdx so .mdx files imported anywhere in the app compile to
 *     a React component
 *   - remark-frontmatter so `---` blocks at the top of an .mdx file
 *     are parsed (and NOT rendered as horizontal rules)
 *   - remark-mdx-frontmatter so the parsed frontmatter is re-exposed
 *     as a named `frontmatter` export on the .mdx module
 *
 * The legal pages at /legal/privacy, /legal/terms, /legal/aup are the
 * first consumers; ADR-066 records the override of PR #497 that
 * re-enables a Next.js scaffold for chiefaia.com.
 */

import createMDX from '@next/mdx';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  trailingSlash: false,
  output: 'standalone',
  // Standalone output traces deps relative to `next.config.mjs`. In
  // the monorepo, runtime deps live at `<repo>/node_modules` (pnpm
  // hoists some) AND at the per-app `apps/chiefaia-site/node_modules`.
  // Setting `outputFileTracingRoot` to the workspace root makes the
  // trace include both, so the standalone image can resolve workspace
  // deps like `@caia/ui` and `@chiefaia/tracing` at runtime.
  outputFileTracingRoot: join(__dirname, '../../'),
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
