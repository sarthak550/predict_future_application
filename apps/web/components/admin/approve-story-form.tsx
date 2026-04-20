"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function ApproveStoryForm({ storyId }: { storyId: string }) {
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
            const response = await fetch("/api/admin/news/approve", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ storyId })
            });
            const payload = (await response.json()) as { error?: string };
            setMessage(response.ok ? "Approved." : payload.error ?? "Action failed.");
            if (response.ok) {
              router.refresh();
            }
          })
        }
      >
        {isPending ? "Approving..." : "Approve"}
      </Button>
      {message && <span className="text-xs text-ink-500">{message}</span>}
    </div>
  );
}
