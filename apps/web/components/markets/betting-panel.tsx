"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

const BET_PRESETS = [50, 100, 250, 500, 1000];

function calcEstimatedReturn(
  side: "YES" | "NO",
  amount: number,
  yesPool: number,
  noPool: number
): number {
  const projectedYesPool = side === "YES" ? yesPool + amount : yesPool;
  const projectedNoPool = side === "NO" ? noPool + amount : noPool;
  if (side === "YES") {
    if (projectedYesPool === 0) return amount;
    return Math.floor(amount + (amount / projectedYesPool) * projectedNoPool);
  }
  if (projectedNoPool === 0) return amount;
  return Math.floor(amount + (amount / projectedNoPool) * projectedYesPool);
}

type BettingPanelProps = {
  marketId: string;
  marketStatus: string;
  marketType: string;
  yesPool: number;
  noPool: number;
  isAuthenticated: boolean;
};

export function BettingPanel({
  marketId,
  marketStatus,
  yesPool,
  noPool,
  isAuthenticated
}: BettingPanelProps) {
  const isOpen = marketStatus === "OPEN";
  const router = useRouter();

  const [selectedSide, setSelectedSide] = useState<"YES" | "NO" | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const totalPool = yesPool + noPool;
  const yesProbability = totalPool > 0 ? yesPool / totalPool : 0.5;

  const betAmount = customAmount
    ? parseInt(customAmount, 10)
    : (amount ?? 0);

  async function handlePlaceBet() {
    if (!selectedSide) {
      setError("Pick YES or NO.");
      return;
    }
    if (!betAmount || betAmount < 50) {
      setError("Minimum bet is 50 points.");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/markets/${marketId}/positions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ side: selectedSide, amount: betAmount })
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          const message =
            typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string"
              ? payload.error
              : "Failed to place bet. Please try again.";
          setError(message);
          return;
        }

        setSuccess(true);
        router.refresh();
      } catch {
        setError("Network error. Please try again.");
      }
    });
  }

  // ── Unauthenticated ────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="rounded-3xl border border-white/70 bg-white/80 p-6 text-center shadow-sm backdrop-blur">
        <p className="text-base font-semibold text-ink-900">Want to make a prediction?</p>
        <p className="mt-1 text-sm text-ink-500">
          Sign in to stake virtual points on this market.
        </p>
        <div className="mt-4">
          <Link
            href={`/sign-in?redirect=/markets/${marketId}`}
            className="inline-flex items-center justify-center rounded-2xl bg-ink-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-ink-700 focus:outline-none focus:ring-2 focus:ring-signal-sky focus:ring-offset-2"
          >
            Sign in to predict
          </Link>
        </div>
      </div>
    );
  }

  // ── Market not open ────────────────────────────────────────────────────────
  if (!isOpen) {
    return (
      <div className="rounded-3xl border border-ink-100 bg-ink-50/60 p-6 text-center shadow-sm">
        <p className="text-sm font-medium text-ink-500">
          This market is no longer accepting bets.
        </p>
      </div>
    );
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
        <p className="text-base font-semibold text-emerald-700">Bet placed!</p>
        <p className="mt-1 text-sm text-emerald-600">
          Your position has been recorded. You can view it on your profile.
        </p>
        <button
          type="button"
          className="mt-4 text-sm font-medium text-emerald-700 underline"
          onClick={() => {
            setSuccess(false);
            setSelectedSide(null);
            setAmount(null);
            setCustomAmount("");
          }}
        >
          Place another bet
        </button>
      </div>
    );
  }

  // ── Active betting UI ──────────────────────────────────────────────────────
  return (
    <div className="rounded-3xl border border-white/70 bg-white/80 p-6 shadow-sm backdrop-blur sm:p-8">
      <h2 className="text-lg font-semibold text-ink-900">Place your bet</h2>
      <p className="mt-1 text-sm text-ink-500">
        Pick a side and stake virtual points. No real money involved.
      </p>

      {/* Side selection */}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setSelectedSide("YES")}
          className={[
            "flex flex-col items-center rounded-2xl border-2 py-4 transition",
            selectedSide === "YES"
              ? "border-emerald-500 bg-emerald-50"
              : "border-emerald-100 bg-emerald-50/40 hover:border-emerald-300"
          ].join(" ")}
        >
          <span className="text-xl font-extrabold tracking-widest text-emerald-700">YES</span>
          <span className="mt-1 text-xs text-ink-500">
            {Math.round(yesProbability * 100)}% probability
          </span>
        </button>
        <button
          type="button"
          onClick={() => setSelectedSide("NO")}
          className={[
            "flex flex-col items-center rounded-2xl border-2 py-4 transition",
            selectedSide === "NO"
              ? "border-rose-500 bg-rose-50"
              : "border-rose-100 bg-rose-50/40 hover:border-rose-300"
          ].join(" ")}
        >
          <span className="text-xl font-extrabold tracking-widest text-rose-700">NO</span>
          <span className="mt-1 text-xs text-ink-500">
            {Math.round((1 - yesProbability) * 100)}% probability
          </span>
        </button>
      </div>

      {/* Amount presets */}
      <div className="mt-5">
        <p className="mb-2 text-sm font-medium text-ink-700">Amount</p>
        <div className="flex flex-wrap gap-2">
          {BET_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setAmount(preset);
                setCustomAmount("");
              }}
              className={[
                "rounded-full px-4 py-1.5 text-sm font-semibold transition",
                amount === preset && !customAmount
                  ? "bg-ink-900 text-white"
                  : "bg-ink-100 text-ink-700 hover:bg-ink-200"
              ].join(" ")}
            >
              {preset}
            </button>
          ))}
        </div>

        <input
          type="number"
          min={50}
          placeholder="Custom amount (min 50)"
          value={customAmount}
          onChange={(e) => {
            setCustomAmount(e.target.value);
            if (e.target.value) setAmount(null);
          }}
          className="mt-3 w-full rounded-2xl border border-ink-200 bg-white px-4 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-signal-sky focus:outline-none focus:ring-2 focus:ring-signal-sky/20"
        />
      </div>

      {/* Estimated return */}
      {selectedSide && betAmount >= 50 && (
        <div className="mt-3 flex items-center justify-between text-sm text-ink-500">
          <span>Estimated return</span>
          <span className="font-semibold text-ink-800">
            {calcEstimatedReturn(selectedSide, betAmount, yesPool, noPool).toLocaleString()} pts
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="mt-3 rounded-2xl bg-rose-50 px-4 py-2 text-sm text-rose-600">{error}</p>
      )}

      {/* Submit */}
      <Button
        className="mt-5 w-full"
        disabled={isPending}
        onClick={handlePlaceBet}
      >
        {isPending
          ? "Placing bet…"
          : betAmount >= 50 && selectedSide
            ? `Bet ${betAmount} pts on ${selectedSide}`
            : "Place bet"}
      </Button>
    </div>
  );
}
