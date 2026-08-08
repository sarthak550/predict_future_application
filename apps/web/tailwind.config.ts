import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f8fafc",
          100: "#e2e8f0",
          200: "#cbd5e1",
          300: "#94a3b8",
          400: "#64748b",
          500: "#475569",
          600: "#334155",
          700: "#1e293b",
          800: "#0f172a",
          900: "#020617"
        },
        signal: {
          teal: "#14b8a6",
          amber: "#f59e0b",
          coral: "#f97316",
          sky: "#0ea5e9",
          // Markets/Pulse pillar accent (Indigo Futures direction: Analysts=blue/sky,
          // Markets=emerald). Matches the emerald-600 already used ad hoc for
          // "gainer" tone in top-movers-card.tsx — named here so new Markets-pillar
          // surfaces (homepage redesign, 2026-08-09) reference one token instead of
          // repeating the raw hex.
          emerald: "#059669"
        }
      },
      boxShadow: {
        glow: "0 20px 80px rgba(14, 165, 233, 0.12)"
      },
      backgroundImage: {
        grid:
          "linear-gradient(rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.08) 1px, transparent 1px)"
      }
    }
  },
  plugins: []
};

export default config;
