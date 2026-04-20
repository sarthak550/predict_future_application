"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { GroupSummary } from "@/lib/groups/types";

export function CreateGroupForm({
  onCreated
}: {
  onCreated?: (group: GroupSummary) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-3 rounded-[24px] border border-ink-100 p-4">
      <div>
        <p className="font-medium text-ink-900">Create a group</p>
        <p className="text-sm text-ink-500">Start a private circle for friends, work, or campus predictions.</p>
      </div>
      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Mumbai office forecasts" />
      <Textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Optional description"
      />
      {message && <p className="text-xs text-ink-500">{message}</p>}
      <Button
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setMessage("");
            const response = await fetch("/api/groups/create", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                name,
                description
              })
            });
            const payload = (await response.json()) as {
              error?: string;
              group?: GroupSummary;
            };

            if (!response.ok || !payload.group) {
              setMessage(payload.error ?? "Unable to create group.");
              return;
            }

            setName("");
            setDescription("");
            setMessage(`Created ${payload.group.name}. Invite code: ${payload.group.inviteCode}`);
            onCreated?.(payload.group);
            router.refresh();
          })
        }
      >
        {isPending ? "Creating..." : "Create group"}
      </Button>
    </div>
  );
}
