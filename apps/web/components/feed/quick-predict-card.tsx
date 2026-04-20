"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PositionSide } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { calculateEstimatedReturn, calculateProbabilities } from "@/lib/markets/probability";
import { formatPercent, formatPoints } from "@/lib/utils";

export function QuickPredictCard({
  marketId,
  status,
  yesPool,
  noPool,
  balance,
  canTrade,
  currentSide,
  currentAmount
}: {
  marketId: string;
  status: string;
  yesPool: number;
  noPool: number;
  balance?: number;
  canTrade: boolean;
  currentSide?: "YES" | "NO";
  currentAmount?: number;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(300);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const probability = useMemo(() => calculateProbabilities(yesPool, noPool), [yesPool, noPool]);
  const crowdSide = probability.yesProbability >= 0.5 ? "YES" : "NO";

  const estimatedYesReturn = useMemo(
    () => calculateEstimatedReturn(PositionSide.YES, amount, yesPool, noPool),
    [amount, noPool, yesPool]
  );
  const estimatedNoReturn = useMemo(
    () => calculateEstimatedReturn(PositionSide.NO, amount, yesPool, noPool),
    [amount, noPool, yesPool]
  );

  if (!canTrade) {
    return (
      <Link href="/sign-in">
        <Button className="w-full">Sign in to predict</Button>
      </Link>
    );
  }

  async function submit(side: PositionSide) {
    startTransition(async () => {
      setError("");
      setMessage("");

      const response = await fetch(`/api/markets/${marketId}/positions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          side,
          amount
        })
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Unable to place prediction.");
        return;
      }

      setMessage(`Prediction placed on ${side}.`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-[22px] bg-ink-50 px-4 py-3 text-sm">
        <div>
          <p className="text-ink-500">Balance</p>
          <p className="font-semibold text-ink-900">{formatPoints(balance ?? 0)} pts</p>
        </div>
        <div className="text-right">
          <p className="text-ink-500">Crowd lean</p>
          <p className="font-semibold text-ink-900">{crowdSide}</p>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Virtual points</label>
        <Input
          type="number"
          min={50}
          step={50}
          value={amount}
          onChange={(event) => setAmount(Number(event.target.value))}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={isPending || status !== "OPEN"}
          onClick={() => submit(PositionSide.YES)}
          className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-4 py-4 text-left transition hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Predict YES</p>
          <p className="mt-2 text-lg font-semibold text-ink-900">{formatPercent(probability.yesProbability)}</p>
          <p className="mt-1 text-sm text-ink-500">Est. {formatPoints(estimatedYesReturn)} pts</p>
        </button>
        <button
          type="button"
          disabled={isPending || status !== "OPEN"}
          onClick={() => submit(PositionSide.NO)}
          className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-4 text-left transition hover:border-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-700">Predict NO</p>
          <p className="mt-2 text-lg font-semibold text-ink-900">{formatPercent(probability.noProbability)}</p>
          <p className="mt-1 text-sm text-ink-500">Est. {formatPoints(estimatedNoReturn)} pts</p>
        </button>
      </div>

      {currentSide && (
        <div className="rounded-[22px] bg-white px-4 py-3 text-sm text-ink-600 shadow-sm">
          <p>
            Your latest call:{" "}
            <span className="font-semibold text-ink-900">
              {currentSide} with {formatPoints(currentAmount ?? 0)} pts
            </span>
          </p>
          <p className="mt-1">
            You vs crowd:{" "}
            <span className="font-semibold text-ink-900">
              {currentSide === crowdSide ? "Aligned with the crowd" : "Taking a contrarian view"}
            </span>
          </p>
        </div>
      )}

      {status !== "OPEN" && (
        <p className="text-sm text-ink-500">
          This prediction is {status.toLowerCase().replaceAll("_", " ")} and no longer accepts new positions.
        </p>
      )}
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {message && <p className="text-sm text-emerald-700">{message}</p>}
    </div>
  );
}
