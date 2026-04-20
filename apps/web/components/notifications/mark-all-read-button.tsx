"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function MarkAllReadButton() {
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="secondary"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const response = await fetch("/api/notifications", {
              method: "PATCH"
            });
            setMessage(response.ok ? "All notifications marked read." : "Unable to update notifications.");
            if (response.ok) {
              router.refresh();
            }
          })
        }
      >
        {isPending ? "Updating..." : "Mark all read"}
      </Button>
      {message && <p className="text-sm text-ink-500">{message}</p>}
    </div>
  );
}
