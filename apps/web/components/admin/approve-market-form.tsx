"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function ApproveMarketForm({ marketId }: { marketId: string }) {
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex items-center gap-3">
      <Button
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const response = await fetch(`/api/admin/markets/${marketId}/approve`, {
              method: "POST"
            });
            const payload = (await response.json()) as { error?: string };
            setMessage(response.ok ? "Approved." : payload.error ?? "Action failed.");
            router.refresh();
          })
        }
      >
        {isPending ? "Approving..." : "Approve"}
      </Button>
      {message && <span className="text-xs text-ink-500">{message}</span>}
    </div>
  );
}
