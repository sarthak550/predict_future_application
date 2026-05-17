/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Skip Next's ESLint pass during prod builds — TypeScript ESLint plugin
    // resolution conflicts with monorepo workspace setup on Vercel.
    ignoreDuringBuilds: true,
  },
  transpilePackages: [
    "@predict-future/api-client",
    "@predict-future/auth-shared",
    "@predict-future/business-rules",
    "@predict-future/config",
    "@predict-future/types",
    "@predict-future/ui-tokens",
    "@predict-future/utils",
    "@predict-future/validation"
  ],
  webpack: (config) => {
    config.infrastructureLogging = { level: "error" };
    return config;
  }
};

export default nextConfig;
