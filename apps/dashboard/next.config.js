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
  // Server-only packages whose Node-intrinsic deps (`net`, `tls`, etc.)
  // webpack can't bundle. They stay as runtime `require`s in the
  // standalone server; `outputFileTracingIncludes` above ensures their
  // dist/ is shipped. Added for the Step 3 Interview routes, which
  // import @chiefaia/tracing + @caia/interviewer (latter pulls
  // @chiefaia/claude-spawner transitively).
  serverExternalPackages: [
    '@chiefaia/tracing',
    '@chiefaia/claude-spawner',
    '@caia/interviewer',
    '@opentelemetry/sdk-node',
    '@opentelemetry/exporter-trace-otlp-http',
    '@opentelemetry/exporter-logs-otlp-grpc',
    '@grpc/grpc-js',
  ],
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
