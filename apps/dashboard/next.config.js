/** @type {import('next').NextConfig} */
const URL_REDIRECTS = require('./redirects.js');

const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return URL_REDIRECTS;
  },
};

module.exports = nextConfig;
