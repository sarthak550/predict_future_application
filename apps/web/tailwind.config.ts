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
      keyframes: {
        // Homepage sparkline "draw the line in" reveal (founder ask
        // 2026-08-09: charts should have real visual motion, not just a
        // text badge; follow-up same day: "continuous", not one-time — so
        // the cycle loops: draw 0-22% (~1.1s of the 5s cycle — founder
        // follow-up: 8s read as too infrequent), hold the finished chart
        // until 80%, fade out by 90%, and reset to undrawn while fully
        // invisible so the loop restart never pops. Replays the SAME real
        // data each cycle — motion without fabricating values.
        // Pure CSS, driven by the SVG `pathLength=1` normalization trick on
        // the polyline itself (instrument-sparkline.tsx) — no JS
        // measurement, no flash-of-drawn-then-redraw on hydration.
        "sparkline-draw": {
          "0%": { strokeDashoffset: "1", opacity: "1" },
          "22%": { strokeDashoffset: "0", opacity: "1" },
          "80%": { strokeDashoffset: "0", opacity: "1" },
          "90%": { strokeDashoffset: "0", opacity: "0" },
          "100%": { strokeDashoffset: "1", opacity: "0" }
        },
        // Left-to-right clip-path wipe for the area fill beneath the line —
        // NOT a plain opacity fade for the reveal. An opacity fade reveals
        // the fill's full silhouette (the whole chart shape) almost
        // immediately, which visually swallows the line's own progressive
        // draw-in (verified via a real Playwright capture: at ~1.5s into a
        // deliberately-slowed 6s draw, an opacity-based fill was already
        // fully formed edge-to-edge while the line itself had only drawn
        // ~40% of its length — the reveal read as instant, not "drawing
        // in"). Opacity IS used for the 88-94% fade-out, where hiding the
        // whole silhouette at once is exactly the intent. Same timeline as
        // `sparkline-draw` so fill and line sweep, hold, and fade in
        // lockstep.
        "sparkline-wipe": {
          "0%": { clipPath: "inset(0 100% 0 0)", opacity: "1" },
          "22%": { clipPath: "inset(0 0% 0 0)", opacity: "1" },
          "80%": { clipPath: "inset(0 0% 0 0)", opacity: "1" },
          "90%": { clipPath: "inset(0 0% 0 0)", opacity: "0" },
          "100%": { clipPath: "inset(0 100% 0 0)", opacity: "0" }
        }
      },
      animation: {
        "sparkline-draw": "sparkline-draw 5s ease-out infinite",
        "sparkline-wipe": "sparkline-wipe 5s ease-out infinite"
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
