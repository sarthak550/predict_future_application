/** @type {import('next').NextConfig} */
const nextConfig = {
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
