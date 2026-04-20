"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function RunNewsIngestionForm() {
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
            setMessage("");
            const response = await fetch("/api/admin/news/ingest", {
              method: "POST"
            });
            const payload = (await response.json()) as {
              error?: string;
              details?: string[];
              ingested?: number;
              skippedDuplicates?: number;
              published?: number;
              errors?: string[];
            };
            const providerErrors = payload.details ?? payload.errors ?? [];
            setMessage(
              response.ok
                ? `Fetched latest RSS stories. ${payload.ingested ?? 0} new, ${payload.published ?? 0} published, ${payload.skippedDuplicates ?? 0} skipped.`
                : payload.error ?? providerErrors[0] ?? "Unable to fetch stories."
            );
            if (providerErrors.length > 0 && response.ok) {
              setMessage((current) => `${current} Issues: ${providerErrors.slice(0, 2).join(" | ")}`);
            }
            if (response.ok) {
              router.refresh();
            }
          })
        }
      >
        {isPending ? "Fetching..." : "Fetch RSS now"}
      </Button>
      {message && <span className="text-xs text-ink-500">{message}</span>}
    </div>
  );
}
