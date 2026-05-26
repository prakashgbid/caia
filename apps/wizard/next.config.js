/**
 * Wizard Next.js config — customer-facing app served at
 * dashboard.chiefaia.com. Mirrors apps/dashboard's standalone bundling
 * and `outputFileTracingIncludes` for `@chiefaia/tracing` so OTel
 * loads correctly under dynamic import from instrumentation.ts.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: require('path').join(__dirname, '../../'),
  outputFileTracingIncludes: {
    '*': [
      '../../packages/tracing/dist/**',
      '../../packages/tracing/package.json',
      '../../node_modules/@opentelemetry/**',
      '../../node_modules/.pnpm/@opentelemetry+**',
    ],
  },
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
