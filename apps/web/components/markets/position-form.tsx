"use client";

import Link from "next/link";
import { MarketType, PositionSide } from "@prisma/client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { calculateEstimatedReturn, calculateProbabilities } from "@/lib/markets/probability";
import { formatNumericValue, formatPercent, formatPoints } from "@/lib/utils";

type PositionFormProps = {
  marketId: string;
  marketType: MarketType;
  status: string;
  yesPool: number;
  noPool: number;
  totalVolume: number;
  balance?: number;
  canTrade: boolean;
  isAuthenticated?: boolean;
  disabledReason?: string;
  winnersCount?: number | null;
  payoutDistribution?: number[] | null;
  unit?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  precision?: number | null;
};

export function PositionForm({
  marketId,
  marketType,
  status,
  yesPool,
  noPool,
  totalVolume,
  balance,
  canTrade,
  isAuthenticated = false,
  disabledReason,
  winnersCount,
  payoutDistribution,
  unit,
  minValue,
  maxValue,
  precision
}: PositionFormProps) {
  const [side, setSide] = useState<PositionSide>(PositionSide.YES);
  const [numericValue, setNumericValue] = useState("");
  const [amount, setAmount] = useState(500);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const probability = useMemo(() => calculateProbabilities(yesPool, noPool), [yesPool, noPool]);
  const estimatedReturn = useMemo(
    () => calculateEstimatedReturn(side, amount, yesPool, noPool),
    [side, amount, yesPool, noPool]
  );

  if (!isAuthenticated) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Take a position</CardTitle>
          <CardDescription>Sign in to forecast with virtual points.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/sign-in">
            <Button>Sign in to participate</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (!canTrade) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Take a position</CardTitle>
          <CardDescription>Position entry is disabled for this market.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="rounded-2xl bg-ink-50 px-4 py-3 text-sm text-ink-600">
            {disabledReason ?? "You cannot take a position right now."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{marketType === MarketType.NUMERIC ? "Submit your guess" : "Take a position"}</CardTitle>
        <CardDescription>
          {marketType === MarketType.NUMERIC
            ? "Submit one numeric estimate with virtual points. The closest guess bands win automatically when the host submits the actual value."
            : "Commit virtual points to YES or NO. No cash, no deposits, no withdrawals."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-[24px] bg-ink-50 p-4">
          <div>
            <p className="text-sm text-ink-500">Available balance</p>
            <p className="text-lg font-semibold text-ink-900">{formatPoints(balance ?? 0)} pts</p>
          </div>
          <Badge variant={status === "OPEN" ? "success" : "warning"}>{status.toLowerCase()}</Badge>
        </div>

        {marketType === MarketType.BINARY ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSide(PositionSide.YES)}
                className={`rounded-3xl border p-4 text-left transition ${
                  side === PositionSide.YES ? "border-emerald-500 bg-emerald-50" : "border-ink-200 bg-white"
                }`}
              >
                <p className="text-sm text-ink-500">YES probability</p>
                <p className="mt-2 text-2xl font-semibold text-ink-900">
                  {formatPercent(probability.yesProbability)}
                </p>
              </button>
              <button
                type="button"
                onClick={() => setSide(PositionSide.NO)}
                className={`rounded-3xl border p-4 text-left transition ${
                  side === PositionSide.NO ? "border-rose-500 bg-rose-50" : "border-ink-200 bg-white"
                }`}
              >
                <p className="text-sm text-ink-500">NO probability</p>
                <p className="mt-2 text-2xl font-semibold text-ink-900">
                  {formatPercent(probability.noProbability)}
                </p>
              </button>
            </div>
          </>
        ) : (
          <div className="rounded-[24px] border border-ink-100 bg-white p-4 text-sm text-ink-600">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-sm text-ink-500">Winner slots</p>
                <p className="mt-1 text-xl font-semibold text-ink-900">{winnersCount ?? 1}</p>
              </div>
              <div>
                <p className="text-sm text-ink-500">Current pool</p>
                <p className="mt-1 text-xl font-semibold text-ink-900">{formatPoints(totalVolume)} pts</p>
              </div>
            </div>
            {payoutDistribution && payoutDistribution.length > 0 && (
              <p className="mt-3">
                Payout distribution: {payoutDistribution.map((value) => `${value}%`).join(" / ")}
              </p>
            )}
            <p className="mt-2">
              {minValue !== null && minValue !== undefined ? `Min ${formatNumericValue(minValue, { unit, precision })}` : "No minimum"}
              {" · "}
              {maxValue !== null && maxValue !== undefined ? `Max ${formatNumericValue(maxValue, { unit, precision })}` : "No maximum"}
              {" · "}
              Precision {precision ?? 0} decimals
            </p>
          </div>
        )}

        {marketType === MarketType.NUMERIC && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-ink-700">Your guess</label>
            <Input
              type="number"
              min={minValue ?? 0}
              max={maxValue ?? undefined}
              step={precision && precision > 0 ? 1 / 10 ** precision : 1}
              value={numericValue}
              onChange={(event) => setNumericValue(event.target.value)}
              placeholder={unit ? `Enter value in ${unit}` : "Enter a number"}
            />
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-700">Virtual points</label>
          <Input
            type="number"
            min={50}
            step={50}
            value={amount}
            onChange={(event) => setAmount(Number(event.target.value))}
          />
        </div>

        <div className="rounded-[24px] bg-ink-50 p-4 text-sm text-ink-600">
          {marketType === MarketType.BINARY ? (
            <>
              <p>
                Estimated return if correct:{" "}
                <span className="font-semibold text-ink-900">{formatPoints(estimatedReturn)} pts</span>
              </p>
              <p className="mt-1">This estimate uses the current pool sizes and updates as more forecasts come in.</p>
            </>
          ) : (
            <>
              <p className="font-medium text-ink-900">Numeric payout note</p>
              <p className="mt-1">
                The system ranks guesses by absolute difference from the actual result. The host cannot pick winners manually.
              </p>
            </>
          )}
        </div>

        {error && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}
        {success && <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</p>}

        <Button
          className="w-full"
          disabled={isPending || status !== "OPEN"}
          onClick={() =>
            startTransition(async () => {
              setError("");
              setSuccess("");
              if (marketType === MarketType.NUMERIC && numericValue.trim() === "") {
                setError("Enter a numeric guess before confirming.");
                return;
              }
              const response = await fetch(`/api/markets/${marketId}/positions`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  side: marketType === MarketType.BINARY ? side : undefined,
                  numericValue: marketType === MarketType.NUMERIC ? Number(numericValue) : undefined,
                  amount
                })
              });
              const payload = (await response.json()) as { error?: string };
              if (!response.ok) {
                setError(payload.error ?? "Unable to place position.");
                return;
              }

              setSuccess(marketType === MarketType.NUMERIC ? "Guess submitted." : "Position confirmed.");
              router.refresh();
            })
          }
        >
          {isPending ? "Submitting..." : marketType === MarketType.NUMERIC ? "Confirm guess" : "Confirm position"}
        </Button>
      </CardContent>
    </Card>
  );
}
