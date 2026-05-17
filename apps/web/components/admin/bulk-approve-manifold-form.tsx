"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function BulkApproveManifoldForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleApprove() {
    startTransition(async () => {
      setMessage(null);
      const response = await fetch("/api/admin/markets/bulk-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ originPlatform: "manifold", status: "PENDING_REVIEW" }),
      });
      const payload = (await response.json()) as {
        approved?: number;
        skipped?: number;
        error?: string;
      };
      if (response.ok) {
        setMessage(`Approved ${payload.approved ?? 0} markets (${payload.skipped ?? 0} already open, skipped).`);
        router.refresh();
      } else {
        setMessage(payload.error ?? "Action failed.");
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="primary"
        disabled={isPending}
        onClick={handleApprove}
      >
        {isPending ? "Approving..." : "Approve all pending Manifold markets"}
      </Button>
      {message && (
        <span className="text-sm text-ink-600">{message}</span>
      )}
    </div>
  );
}
