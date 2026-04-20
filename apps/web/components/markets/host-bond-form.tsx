"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type HostBondFormProps = {
  marketId: string;
  disabled?: boolean;
  disabledReason?: string;
};

export function HostBondForm({
  marketId,
  disabled = false,
  disabledReason
}: HostBondFormProps) {
  const router = useRouter();
  const [amount, setAmount] = useState("500");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      <Input
        type="number"
        min={50}
        step={50}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        disabled={disabled || isPending}
        placeholder="Additional host bond"
      />
      {disabledReason && <p className="rounded-2xl bg-ink-50 px-4 py-3 text-sm text-ink-600">{disabledReason}</p>}
      {message && <p className="rounded-2xl bg-ink-50 px-4 py-3 text-sm text-ink-600">{message}</p>}
      <Button
        size="sm"
        disabled={disabled || isPending}
        onClick={() =>
          startTransition(async () => {
            setMessage("");
            const response = await fetch(`/api/markets/${marketId}/add-bond`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                amount: Number(amount)
              })
            });
            const payload = (await response.json()) as { error?: string };
            setMessage(response.ok ? "Bond cap updated." : payload.error ?? "Unable to add bond.");
            if (response.ok) {
              router.refresh();
            }
          })
        }
      >
        {isPending ? "Adding..." : "Add bond"}
      </Button>
    </div>
  );
}
