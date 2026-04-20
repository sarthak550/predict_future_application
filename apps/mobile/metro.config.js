const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch all packages in the monorepo
config.watchFolders = [monorepoRoot];

// Resolve modules from both the app and monorepo root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Override expo-router's _ctx files with our local version that has a static path
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "expo-router/_ctx") {
    return {
      filePath: path.resolve(projectRoot, "ctx.js"),
      type: "sourceFile",
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
