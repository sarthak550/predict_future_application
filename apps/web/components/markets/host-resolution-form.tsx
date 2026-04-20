"use client";

import { MarketType } from "@prisma/client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatNumericValue } from "@/lib/utils";

type HostResolutionFormProps = {
  marketId: string;
  modeLabel: string;
  marketType: MarketType;
  unit?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  precision?: number | null;
  disabled?: boolean;
  disabledReason?: string;
};

export function HostResolutionForm({
  marketId,
  modeLabel,
  marketType,
  unit,
  minValue,
  maxValue,
  precision,
  disabled = false,
  disabledReason
}: HostResolutionFormProps) {
  const router = useRouter();
  const [outcome, setOutcome] = useState("YES");
  const [numericAction, setNumericAction] = useState("RESOLVE");
  const [actualValue, setActualValue] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [evidenceText, setEvidenceText] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      {marketType === MarketType.BINARY ? (
        <Select value={outcome} onChange={(event) => setOutcome(event.target.value)} disabled={disabled || isPending}>
          <option value="YES">YES</option>
          <option value="NO">NO</option>
          <option value="CANCELLED">CANCELLED</option>
        </Select>
      ) : (
        <>
          <Select
            value={numericAction}
            onChange={(event) => setNumericAction(event.target.value)}
            disabled={disabled || isPending}
          >
            <option value="RESOLVE">Submit actual value</option>
            <option value="CANCELLED">Cancel and refund</option>
          </Select>
          {numericAction !== "CANCELLED" && (
            <div className="space-y-2">
              <Input
                type="number"
                min={minValue ?? 0}
                max={maxValue ?? undefined}
                step={precision && precision > 0 ? 1 / 10 ** precision : 1}
                value={actualValue}
                onChange={(event) => setActualValue(event.target.value)}
                placeholder={unit ? `Actual value in ${unit}` : "Actual resolved value"}
                disabled={disabled || isPending}
              />
              <p className="text-xs text-ink-500">
                {minValue !== null && minValue !== undefined ? `Min ${formatNumericValue(minValue, { unit, precision })}` : "No minimum"}
                {" · "}
                {maxValue !== null && maxValue !== undefined ? `Max ${formatNumericValue(maxValue, { unit, precision })}` : "No maximum"}
              </p>
            </div>
          )}
        </>
      )}
      <Textarea
        value={resolutionNote}
        onChange={(event) => setResolutionNote(event.target.value)}
        placeholder={
          marketType === MarketType.NUMERIC
            ? `Explain exactly how the actual value was determined for this ${modeLabel.toLowerCase()} rule.`
            : `Explain exactly how the ${modeLabel.toLowerCase()} rule was applied.`
        }
        disabled={disabled || isPending}
      />
      <Textarea
        value={evidenceText}
        onChange={(event) => setEvidenceText(event.target.value)}
        placeholder="Optional evidence summary"
        disabled={disabled || isPending}
      />
      <Input
        value={evidenceUrl}
        onChange={(event) => setEvidenceUrl(event.target.value)}
        placeholder="Optional evidence URL"
        disabled={disabled || isPending}
      />
      {disabledReason && <p className="rounded-2xl bg-ink-50 px-4 py-3 text-sm text-ink-600">{disabledReason}</p>}
      {message && <p className="rounded-2xl bg-ink-50 px-4 py-3 text-sm text-ink-600">{message}</p>}
      <Button
        size="sm"
        disabled={disabled || isPending}
        onClick={() =>
          startTransition(async () => {
            if (marketType === MarketType.NUMERIC && numericAction !== "CANCELLED" && actualValue.trim() === "") {
              setMessage("Enter the actual resolved value before submitting.");
              return;
            }
            const response = await fetch(`/api/markets/${marketId}/resolve`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                outcome:
                  marketType === MarketType.BINARY
                    ? outcome
                    : numericAction === "CANCELLED"
                      ? "CANCELLED"
                      : undefined,
                actualValue:
                  marketType === MarketType.NUMERIC && numericAction !== "CANCELLED"
                    ? Number(actualValue)
                    : undefined,
                resolutionNote,
                evidenceText,
                evidenceUrl
              })
            });
            const payload = (await response.json()) as { error?: string };
            setMessage(response.ok ? "Resolution submitted." : payload.error ?? "Action failed.");
            if (response.ok) {
              router.refresh();
            }
          })
        }
      >
        {isPending ? "Submitting..." : "Submit host resolution"}
      </Button>
    </div>
  );
}
