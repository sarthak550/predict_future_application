"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GroupSummary } from "@/lib/groups/types";

export function JoinGroupForm({
  onJoined
}: {
  onJoined?: (group: GroupSummary) => void;
}) {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-3 rounded-[24px] border border-ink-100 p-4">
      <div>
        <p className="font-medium text-ink-900">Join by invite code</p>
        <p className="text-sm text-ink-500">Enter a group code to unlock private predictions and leaderboards.</p>
      </div>
      <Input
        value={inviteCode}
        onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
        placeholder="AB12CD34"
      />
      {message && <p className="text-xs text-ink-500">{message}</p>}
      <Button
        size="sm"
        variant="secondary"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setMessage("");
            const response = await fetch("/api/groups/join", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                inviteCode
              })
            });
            const payload = (await response.json()) as {
              error?: string;
              group?: GroupSummary;
            };

            if (!response.ok || !payload.group) {
              setMessage(payload.error ?? "Unable to join group.");
              return;
            }

            setInviteCode("");
            setMessage(`Joined ${payload.group.name}.`);
            onJoined?.(payload.group);
            router.refresh();
          })
        }
      >
        {isPending ? "Joining..." : "Join group"}
      </Button>
    </div>
  );
}
