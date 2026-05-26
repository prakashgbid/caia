/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The marketing site is fully static — Vercel/Cloudflare Pages will serve it
  // as static HTML. App Router still emits the dynamic OG/sitemap/robots/manifest
  // routes correctly under `output: 'standalone'` or default.
  poweredByHeader: false,
  // Force trailing-slash off so canonical URLs match the sitemap.
  trailingSlash: false,
  // Site lives at https://chiefaia.com — surfaced for OG/canonical/sitemap
  // generation. Override via env in preview environments.
  env: {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || 'https://chiefaia.com',
  },
  transpilePackages: ['@caia/ui'],
};

module.exports = nextConfig;
