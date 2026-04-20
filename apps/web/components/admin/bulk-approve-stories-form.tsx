"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function BulkApproveStoriesForm() {
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex items-center gap-3">
      <Button
        size="sm"
        variant="secondary"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setMessage("");

            const response = await fetch("/api/admin/news/bulk-approve", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                limit: 25,
                trustedOnly: true
              })
            });

            const payload = (await response.json()) as {
              error?: string;
              approved?: number;
              skipped?: number;
              errors?: string[];
            };

            setMessage(
              response.ok
                ? `Published ${payload.approved ?? 0} eligible stories. ${payload.skipped ?? 0} skipped.`
                : payload.error ?? "Unable to bulk publish stories."
            );

            if (response.ok) {
              router.refresh();
            }
          })
        }
      >
        {isPending ? "Publishing..." : "Publish eligible drafts"}
      </Button>
      {message && <span className="text-xs text-ink-500">{message}</span>}
    </div>
  );
}
