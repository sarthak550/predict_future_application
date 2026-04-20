"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type ChallengeFormProps = {
  marketId: string;
  canChallenge: boolean;
  disabledReason?: string;
};

export function ChallengeForm({ marketId, canChallenge, disabledReason }: ChallengeFormProps) {
  const router = useRouter();
  const [reasonText, setReasonText] = useState("");
  const [evidenceText, setEvidenceText] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      <Textarea
        value={reasonText}
        onChange={(event) => setReasonText(event.target.value)}
        placeholder="Why should this resolution be reviewed?"
        disabled={!canChallenge || isPending}
      />
      <Textarea
        value={evidenceText}
        onChange={(event) => setEvidenceText(event.target.value)}
        placeholder="Optional evidence summary"
        disabled={!canChallenge || isPending}
      />
      <Input
        value={evidenceUrl}
        onChange={(event) => setEvidenceUrl(event.target.value)}
        placeholder="Optional evidence URL"
        disabled={!canChallenge || isPending}
      />
      {disabledReason && <p className="rounded-2xl bg-ink-50 px-4 py-3 text-sm text-ink-600">{disabledReason}</p>}
      {message && <p className="rounded-2xl bg-ink-50 px-4 py-3 text-sm text-ink-600">{message}</p>}
      <Button
        size="sm"
        variant="secondary"
        disabled={!canChallenge || isPending}
        onClick={() =>
          startTransition(async () => {
            const response = await fetch(`/api/markets/${marketId}/challenge`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                reasonText,
                evidenceText,
                evidenceUrl
              })
            });
            const payload = (await response.json()) as { error?: string };
            setMessage(response.ok ? "Challenge filed for review." : payload.error ?? "Action failed.");
            if (response.ok) {
              router.refresh();
            }
          })
        }
      >
        {isPending ? "Submitting..." : "Challenge outcome"}
      </Button>
    </div>
  );
}
