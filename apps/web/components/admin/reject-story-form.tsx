"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RejectStoryForm({ storyId }: { storyId: string }) {
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="space-y-2">
      <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reject reason for staff log" />
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="danger"
          disabled={isPending || reason.trim().length < 8}
          onClick={() =>
            startTransition(async () => {
              const response = await fetch("/api/admin/news/reject", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({ storyId, reason })
              });
              const payload = (await response.json()) as { error?: string };
              setMessage(response.ok ? "Rejected." : payload.error ?? "Action failed.");
              if (response.ok) {
                router.refresh();
              }
            })
          }
        >
          {isPending ? "Rejecting..." : "Reject"}
        </Button>
        {message && <span className="text-xs text-ink-500">{message}</span>}
      </div>
    </div>
  );
}
