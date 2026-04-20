"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { reportReasons } from "@/lib/constants";

export function ReportMarketForm({
  marketId,
  canReport
}: {
  marketId: string;
  canReport: boolean;
}) {
  const [reason, setReason] = useState<string>(reportReasons[0]);
  const [details, setDetails] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (!canReport) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Flag this market</CardTitle>
        <CardDescription>Report unclear, duplicate, or disallowed content for staff review.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select value={reason} onChange={(event) => setReason(event.target.value)}>
          {reportReasons.map((reasonOption) => (
            <option key={reasonOption} value={reasonOption}>
              {reasonOption}
            </option>
          ))}
        </Select>
        <Textarea
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          placeholder="Add context for moderators."
          className="min-h-[100px]"
        />
        {message && <p className="rounded-2xl bg-ink-50 px-4 py-3 text-sm text-ink-600">{message}</p>}
        <Button
          variant="secondary"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const response = await fetch(`/api/markets/${marketId}/reports`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({ reason, details })
              });
              const payload = (await response.json()) as { error?: string };
              setMessage(response.ok ? "Report submitted." : payload.error ?? "Unable to submit report.");
              if (response.ok) {
                setDetails("");
                router.refresh();
              }
            })
          }
        >
          {isPending ? "Submitting..." : "Submit report"}
        </Button>
      </CardContent>
    </Card>
  );
}
