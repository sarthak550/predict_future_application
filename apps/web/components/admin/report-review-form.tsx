"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function ReportReviewForm({ reportId }: { reportId: string }) {
  const [status, setStatus] = useState("REVIEWING");
  const [explanation, setExplanation] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="space-y-3">
      <Select value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="REVIEWING">Mark reviewing</option>
        <option value="RESOLVED">Resolve report</option>
        <option value="DISMISSED">Dismiss report</option>
      </Select>
      <Textarea
        value={explanation}
        onChange={(event) => setExplanation(event.target.value)}
        placeholder="What action was taken?"
        className="min-h-[100px]"
      />
      {message && <p className="rounded-2xl bg-ink-50 px-4 py-3 text-sm text-ink-600">{message}</p>}
      <Button
        size="sm"
        variant="secondary"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const response = await fetch(`/api/admin/reports/${reportId}`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ status, explanation })
            });
            const payload = (await response.json()) as { error?: string };
            setMessage(response.ok ? "Report updated." : payload.error ?? "Action failed.");
            if (response.ok) {
              router.refresh();
            }
          })
        }
      >
        {isPending ? "Saving..." : "Update report"}
      </Button>
    </div>
  );
}
