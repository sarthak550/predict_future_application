"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function FeatureMarketForm({
  marketId,
  isFeatured
}: {
  marketId: string;
  isFeatured: boolean;
}) {
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex items-center gap-3">
      <Button
        size="sm"
        variant={isFeatured ? "secondary" : "primary"}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const response = await fetch(`/api/admin/markets/${marketId}/feature`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ featured: !isFeatured })
            });
            const payload = (await response.json()) as { error?: string };
            setMessage(response.ok ? "Saved." : payload.error ?? "Action failed.");
            if (response.ok) {
              router.refresh();
            }
          })
        }
      >
        {isPending ? "Saving..." : isFeatured ? "Remove feature" : "Feature"}
      </Button>
      {message && <span className="text-xs text-ink-500">{message}</span>}
    </div>
  );
}
