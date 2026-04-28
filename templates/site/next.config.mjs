/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['{{DOMAIN}}'],
  },
};

export default nextConfig;
