/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['pdf-parse', 'mammoth', 'xlsx', '@prisma/client'],
  eslint: { ignoreDuringBuilds: true },
  experimental: { serverActions: { bodySizeLimit: '25mb' } },
};
export default nextConfig;
