const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo config plugin that:
 * 1. Adds android:networkSecurityConfig to AndroidManifest.xml
 * 2. Writes res/xml/network_security_config.xml allowing cleartext to dev hosts
 *
 * This survives `expo prebuild --clean` because it runs as part of the prebuild pipeline.
 */
function withNetworkSecurity(config) {
  // Step 1: patch AndroidManifest.xml
  config = withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (app) {
      app.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    }
    return mod;
  });

  // Step 2: write the XML file
  config = withDangerousMod(config, [
    "android",
    (mod) => {
      const xmlDir = path.join(mod.modRequest.platformProjectRoot, "app/src/main/res/xml");
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(
        path.join(xmlDir, "network_security_config.xml"),
        `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">10.0.2.2</domain>
    <domain includeSubdomains="false">192.168.1.2</domain>
  </domain-config>
</network-security-config>
`
      );
      return mod;
    },
  ]);

  return config;
}

module.exports = withNetworkSecurity;
