/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server build (.next/standalone) for the Docker image —
  // same deployment pattern as apps/api (see apps/web/Dockerfile).
  output: "standalone",
  transpilePackages: [
    "@predict-future/api-client",
    "@predict-future/business-rules",
    "@predict-future/config",
    "@predict-future/types",
    "@predict-future/ui-tokens",
    "@predict-future/utils",
    "@predict-future/validation",
    "@predict-future/auth-shared"
  ]
};

export default nextConfig;
