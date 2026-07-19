import { ImageResponse } from "next/og";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const alt = "Analyst call — Predict Future";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function CallOpengraphImage({ params }: { params: { id: string } }) {
  const opinion = await prisma.expertOpinion.findUnique({
    where: { id: params.id },
    select: {
      quote: true,
      instrument: true,
      resolutionStatus: true,
      expert: { select: { name: true, organization: true } },
    },
  });

  const isHit = opinion?.resolutionStatus === "RESOLVED_HIT";
  const name = opinion?.expert.name ?? "Analyst";
  const organization = opinion?.expert.organization ?? "";
  const instrument = opinion?.instrument ?? "";
  const quote = opinion?.quote ?? "";
  const truncatedQuote = quote.length > 180 ? `${quote.slice(0, 180)}…` : quote;

  // Verdict-colored accent only — the overall card layout is identical for HIT and MISS
  // so a MISS never reads as punitive. Neutral slate accent for MISS, not red/alarm.
  const accentColor = isHit ? "#22c55e" : "#94a3b8";
  const verdictLabel = isHit ? "HIT" : "MISS";

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
          backgroundImage: "linear-gradient(135deg, #0f172a 0%, #101827 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 24, display: "flex" }}>
            Predict Future — Analyst Scorecard
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "10px 22px",
              borderRadius: 999,
              backgroundColor: `${accentColor}26`,
              color: accentColor,
              fontSize: 26,
              fontWeight: 700,
            }}
          >
            {verdictLabel}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            color: "#ffffff",
            fontSize: 40,
            lineHeight: 1.4,
            fontWeight: 600,
          }}
        >
          &ldquo;{truncatedQuote}&rdquo;
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ color: "#ffffff", fontSize: 30, fontWeight: 700, display: "flex" }}>{name}</div>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 22, display: "flex" }}>
            {organization}
            {instrument ? ` · ${instrument}` : ""}
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
