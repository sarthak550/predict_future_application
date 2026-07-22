import { ImageResponse } from "next/og";

import { formatSignedPercent } from "@/lib/portfolios/format";
import { getPortfolioDetailBySlug } from "@/lib/portfolios/queries";

// Prisma requires the Node.js runtime — ImageResponse also runs fine there.
export const runtime = "nodejs";
export const alt = "Model Portfolio — Predict Future";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function PortfolioOpengraphImage({ params }: { params: { slug: string } }) {
  const { access, detail } = await getPortfolioDetailBySlug(params.slug, null);
  const portfolio = access === "public" ? detail : null;

  const name = portfolio?.name ?? "Model Portfolio";
  const owner = portfolio?.ownerLabel ?? "Predict Future";
  const returnLabel = portfolio ? formatSignedPercent(portfolio.live.returnPct) : "—";
  const isUp = (portfolio?.live.returnPct ?? 0) >= 0;
  const valueLabel = portfolio ? `₹${portfolio.live.totalValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—";

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
          fontFamily: "sans-serif"
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
              fontWeight: 700
            }}
          >
            PF
          </div>
          <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 24, display: "flex" }}>
            Predict Future — Model Portfolio
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ color: "#ffffff", fontSize: 52, fontWeight: 700, display: "flex" }}>{name}</div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 28, display: "flex" }}>{owner}</div>
        </div>

        <div style={{ display: "flex", gap: 48 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 22, display: "flex" }}>Return since inception</div>
            <div
              style={{
                color: isUp ? "#34d399" : "#fb7185",
                fontSize: 72,
                fontWeight: 700,
                display: "flex"
              }}
            >
              {returnLabel}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 22, display: "flex" }}>Current value</div>
            <div style={{ color: "#ffffff", fontSize: 72, fontWeight: 700, display: "flex" }}>{valueLabel}</div>
          </div>
        </div>

        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 18, display: "flex" }}>
          Model portfolio — hypothetical. Not investment advice.
        </div>
      </div>
    ),
    { ...size }
  );
}
