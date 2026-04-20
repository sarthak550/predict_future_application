/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@predict-future/api-client",
    "@predict-future/auth-shared",
    "@predict-future/business-rules",
    "@predict-future/config",
    "@predict-future/types",
    "@predict-future/ui-tokens",
    "@predict-future/utils",
    "@predict-future/validation"
  ]
};

export default nextConfig;
