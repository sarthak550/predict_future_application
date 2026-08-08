import { ImageResponse } from "next/og";

import { getPublicProfileStats } from "@/lib/finance/publicProfile";
import { prisma } from "@/lib/prisma";

// Prisma requires the Node.js runtime — ImageResponse also runs fine there.
export const runtime = "nodejs";
export const alt = "Analyst Scorecard — Predict Future";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function AnalystOpengraphImage({ params }: { params: { slug: string } }) {
  const expert = await prisma.expert.findUnique({
    where: { slug: params.slug },
    select: {
      name: true,
      organization: true,
      entityKind: true,
      opinions: {
        where: { suppressedAt: null },
        select: { resolutionStatus: true, instrument: true, instrumentTicker: true },
      },
    },
  });

  const isFirm = expert?.entityKind === "FIRM";
  // FIRM entities (publication/desk attributions) never pretend personhood — the
  // headline is the organization, not a synthetic "X Analysis" name.
  const name = isFirm ? (expert?.organization ?? "Market Analysis") : (expert?.name ?? "Analyst");
  const organization = isFirm ? "Market analysis from this source" : (expert?.organization ?? "");
  const stats = expert ? getPublicProfileStats(expert.opinions) : null;
  const hasTrackRecord = stats !== null && stats.resolvedCount >= 3;
  const hitRateLabel = hasTrackRecord ? `${Math.round((stats!.hitRate ?? 0) * 100)}%` : "—";

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px",
          backgroundColor: "#0f172a",
          backgroundImage: "linear-gradient(135deg, #0f172a 0%, #0f2748 55%, #0e3a52 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              height: 56,
              width: 56,
              borderRadius: 18,
              backgroundColor: "rgba(255,255,255,0.12)",
              color: "#fff",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            PF
          </div>
          <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 24, display: "flex" }}>
            Predict Future — Analyst Scorecard
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ color: "#ffffff", fontSize: 56, fontWeight: 700, display: "flex" }}>{name}</div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 30, display: "flex" }}>{organization}</div>
        </div>

        <div style={{ display: "flex", gap: 48 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 22, display: "flex" }}>
              {hasTrackRecord ? "Hit rate" : "Track record"}
            </div>
            <div style={{ color: "#38bdf8", fontSize: 72, fontWeight: 700, display: "flex" }}>
              {hasTrackRecord ? hitRateLabel : "Building"}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 22, display: "flex" }}>Graded calls</div>
            <div style={{ color: "#ffffff", fontSize: 72, fontWeight: 700, display: "flex" }}>
              {stats?.resolvedCount ?? 0}
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
