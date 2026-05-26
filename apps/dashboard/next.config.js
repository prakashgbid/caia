/**
 * Dashboard Next.js config.
 *
 * `output: 'standalone'` + outputFileTracingRoot pulls workspace deps
 * into the standalone bundle. outputFileTracingIncludes force-includes
 * @chiefaia/tracing + OTel SDK because instrumentation.ts loads them
 * via dynamic import (file-tracer can't follow those by default).
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
