import { ImageResponse } from "next/og";

import { fetchInstrumentDetail } from "@/lib/finance/instrument";

// Prisma requires the Node.js runtime — ImageResponse also runs fine there.
export const runtime = "nodejs";
export const alt = "Stock detail — Predict Future";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function InstrumentOpengraphImage({ params }: { params: { symbol: string } }) {
  const instrument = await fetchInstrumentDetail(params.symbol);

  const symbol = params.symbol.trim().toUpperCase();
  const companyName = instrument?.companyName ?? symbol;
  const quote = instrument?.quote ?? null;
  const isUp = quote != null && quote.changePercent >= 0;
  const accentColor = quote == null ? "#94a3b8" : isUp ? "#34d399" : "#fb7185";
  const priceLabel = quote ? `₹${quote.close.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—";
  const changeLabel = quote
    ? `${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%`
    : "Price pending";

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
            Predict Future — Market Pulse
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 26, display: "flex" }}>{symbol} · NSE</div>
          <div style={{ color: "#ffffff", fontSize: 52, fontWeight: 700, display: "flex" }}>{companyName}</div>
        </div>

        <div style={{ display: "flex", gap: 48 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 22, display: "flex" }}>Last close</div>
            <div style={{ color: "#ffffff", fontSize: 72, fontWeight: 700, display: "flex" }}>{priceLabel}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 22, display: "flex" }}>Change</div>
            <div style={{ color: accentColor, fontSize: 72, fontWeight: 700, display: "flex" }}>{changeLabel}</div>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
