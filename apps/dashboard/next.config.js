/**
 * Dashboard Next.js config.
 *
 * `output: 'standalone'` builds the minimal runtime tree at
 * `.next/standalone/` that the Docker image ships. The standalone
 * server starts via `node apps/dashboard/server.js` and bundles only
 * the workspace deps actually traced from the route graph — this is
 * what keeps the final image small without us hand-rolling a node
 * install of the entire monorepo.
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
  output: 'standalone',
  // Standalone output traces deps relative to `next.config.js`. In the
  // monorepo, runtime deps live at `<repo>/node_modules` (pnpm hoists
  // some) AND at the per-app `apps/dashboard/node_modules`. Setting
  // `outputFileTracingRoot` to the workspace root makes the trace
  // include both, so the standalone image can resolve workspace deps
  // like `@caia/state-machine` and `@chiefaia/tracing` at runtime.
  outputFileTracingRoot: require('path').join(__dirname, '../../'),
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
