import { NextResponse } from "next/server";

/**
 * Android App Links association file, served at /.well-known/assetlinks.json via a
 * rewrite in next.config.mjs. Lets shared https links on this domain
 * (/story/<id>, /finance/opinion/<id>) open the installed app directly instead of
 * the browser.
 *
 * The fingerprint is the release APK's signing certificate SHA-256 (obtained via
 * `apksigner verify --print-certs`). If the APK is re-signed with a different
 * keystore (e.g. a Play Store upload key), add that fingerprint here too.
 */
export const dynamic = "force-static";

const ASSET_LINKS = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.predictfuture.mobile",
      sha256_cert_fingerprints: [
        "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C",
      ],
    },
  },
];

export function GET() {
  return NextResponse.json(ASSET_LINKS);
}
