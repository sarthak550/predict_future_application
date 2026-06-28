import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained server bundle for containerized hosting (AWS App Runner / Docker).
  // Emits apps/api/.next/standalone with a minimal node server + only the traced deps.
  output: "standalone",
  experimental: {
    // Trace from the MONOREPO ROOT so the standalone bundle includes the workspace
    // packages (@predict-future/*) and hoisted node_modules. Without this, the bundle
    // misses workspace deps and crashes at runtime.
    // NOTE: in Next 14.x this lives under `experimental`; it only became a top-level
    // key in Next 15 (top-level here triggers an "Unrecognized key" warning).
    outputFileTracingRoot: path.join(__dirname, "../../"),
  },
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
