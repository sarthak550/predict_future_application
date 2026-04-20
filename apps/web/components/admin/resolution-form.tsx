"use client";

import { MarketType } from "@prisma/client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type ResolutionFormProps =
  | {
      marketId: string;
      marketType: MarketType;
      mode: "verified";
    }
  | {
      marketId: string;
      marketType: MarketType;
      mode: "host_review";
    };

export function ResolutionForm(props: ResolutionFormProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const [outcome, setOutcome] = useState("YES");
  const [sourceName, setSourceName] = useState("Manual admin resolution");
  const [sourceUrl, setSourceUrl] = useState("");
  const [explanation, setExplanation] = useState("");

  const [upholdExplanation, setUpholdExplanation] = useState("");
  const [overturnOutcome, setOverturnOutcome] = useState("YES");
  const [overturnActualValue, setOverturnActualValue] = useState("");
  const [overturnSourceName, setOverturnSourceName] = useState("Moderator review");
  const [overturnSourceUrl, setOverturnSourceUrl] = useState("");
  const [overturnExplanation, setOverturnExplanation] = useState("");
  const [overturnedReason, setOverturnedReason] = useState("");
  const [cancelExplanation, setCancelExplanation] = useState("");

  async function post(path: string, body: Record<string, string | number | undefined>) {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const payload = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Action saved." : payload.error ?? "Action failed.");
    if (response.ok) {
      router.refresh();
    }
  }

  if (props.mode === "verified") {
    return (
      <div className="space-y-3">
        <Select value={outcome} onChange={(event) => setOutcome(event.target.value)}>
          <option value="YES">YES</option>
          <option value="NO">NO</option>
          <option value="CANCELLED">CANCELLED</option>
        </Select>
        <Input value={sourceName} onChange={(event) => setSourceName(event.target.value)} placeholder="Source name" />
        <Input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="Source URL" />
        <Textarea
          value={explanation}
          onChange={(event) => setExplanation(event.target.value)}
          placeholder="Explain exactly how the written rule was applied."
        />
        {message && <p className="rounded-2xl bg-ink-50 px-4 py-3 text-sm text-ink-600">{message}</p>}
        <Button
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await post(`/api/admin/markets/${props.marketId}/resolve`, {
                outcome,
                sourceName,
                sourceUrl,
                explanation
              });
            })
          }
        >
          {isPending ? "Resolving..." : "Finalize verified market"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-[24px] border border-ink-100 p-4">
        <p className="text-sm font-medium text-ink-900">Uphold host resolution</p>
        <Textarea
          value={upholdExplanation}
          onChange={(event) => setUpholdExplanation(event.target.value)}
          placeholder="Explain why the host-submitted resolution stands."
        />
        <Button
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await post(`/api/admin/markets/${props.marketId}/uphold`, {
                explanation: upholdExplanation
              });
            })
          }
        >
          {isPending ? "Saving..." : "Uphold resolution"}
        </Button>
      </div>

      <div className="space-y-3 rounded-[24px] border border-ink-100 p-4">
        <p className="text-sm font-medium text-ink-900">Overturn host resolution</p>
        {props.marketType === MarketType.BINARY ? (
          <Select value={overturnOutcome} onChange={(event) => setOverturnOutcome(event.target.value)}>
            <option value="YES">YES</option>
            <option value="NO">NO</option>
          </Select>
        ) : (
          <Input
            type="number"
            value={overturnActualValue}
            onChange={(event) => setOverturnActualValue(event.target.value)}
            placeholder="Correct actual value"
          />
        )}
        <Input
          value={overturnSourceName}
          onChange={(event) => setOverturnSourceName(event.target.value)}
          placeholder="Corrected source name"
        />
        <Input
          value={overturnSourceUrl}
          onChange={(event) => setOverturnSourceUrl(event.target.value)}
          placeholder="Corrected source URL"
        />
        <Textarea
          value={overturnExplanation}
          onChange={(event) => setOverturnExplanation(event.target.value)}
          placeholder="Explain the corrected evidence and why the host submission was wrong."
        />
        <Textarea
          value={overturnedReason}
          onChange={(event) => setOverturnedReason(event.target.value)}
          placeholder="Why was the host resolution overturned?"
        />
        <Button
          size="sm"
          variant="danger"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              if (props.marketType === MarketType.NUMERIC && overturnActualValue.trim() === "") {
                setMessage("Enter the corrected actual value before overturning.");
                return;
              }
              await post(`/api/admin/markets/${props.marketId}/overturn`, {
                outcome: props.marketType === MarketType.BINARY ? overturnOutcome : undefined,
                actualValue:
                  props.marketType === MarketType.NUMERIC && overturnActualValue !== ""
                    ? Number(overturnActualValue)
                    : undefined,
                sourceName: overturnSourceName,
                sourceUrl: overturnSourceUrl,
                explanation: overturnExplanation,
                overturnedReason
              });
            })
          }
        >
          {isPending ? "Saving..." : "Overturn resolution"}
        </Button>
      </div>

      <div className="space-y-3 rounded-[24px] border border-ink-100 p-4">
        <p className="text-sm font-medium text-ink-900">Cancel market and refund</p>
        <Textarea
          value={cancelExplanation}
          onChange={(event) => setCancelExplanation(event.target.value)}
          placeholder="Explain why the market should be cancelled."
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await post(`/api/admin/markets/${props.marketId}/cancel`, {
                explanation: cancelExplanation
              });
            })
          }
        >
          {isPending ? "Saving..." : "Cancel market"}
        </Button>
      </div>

      {message && <p className="rounded-2xl bg-ink-50 px-4 py-3 text-sm text-ink-600">{message}</p>}
    </div>
  );
}
