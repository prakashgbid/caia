/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Cloudflare Pages prefers static export when possible; we keep the default
  // Node runtime for now so we can add server actions / API routes later.
  // To deploy to Pages with adapter, see: https://developers.cloudflare.com/pages/framework-guides/nextjs/
};

module.exports = nextConfig;
