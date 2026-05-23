/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  experimental: {
    serverActions: { allowedOrigins: ['*'] },
  },
  // The onboarding engine lives in a workspace package compiled to ESM;
  // Next handles it via transpilePackages.
  transpilePackages: ['@caia/onboarding'],
};
