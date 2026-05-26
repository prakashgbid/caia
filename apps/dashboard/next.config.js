/**
 * Dashboard Next.js config.
 *
 * `transpilePackages` lists the workspace packages that ship UNCOMPILED
 * TypeScript source (e.g. `@chiefaia/atlas-mapper` whose `package.json`
 * `main` points at `src/index.ts`).
 *
 * `webpack.resolve.extensionAlias` teaches webpack to resolve the
 * `./foo.js` ESM-style imports inside those packages back to their
 * `.ts` sources. Without this, the build fails with
 * "Module not found: Can't resolve './assign-stable-dom-ids.js'".
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@chiefaia/atlas-mapper'],
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

module.exports = nextConfig;
