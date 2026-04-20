"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function UserSuspensionForm({
  userId,
  isSuspended
}: {
  userId: string;
  isSuspended: boolean;
}) {
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="space-y-3">
      {!isSuspended && (
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Suspension reason"
        />
      )}
      {message && <p className="text-xs text-ink-500">{message}</p>}
      <Button
        size="sm"
        variant={isSuspended ? "secondary" : "danger"}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const response = await fetch(`/api/admin/users/${userId}/suspend`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ reason })
            });
            const payload = (await response.json()) as { error?: string };
            setMessage(
              response.ok
                ? isSuspended
                  ? "User reactivated."
                  : "User suspended."
                : payload.error ?? "Action failed."
            );
            if (response.ok) {
              router.refresh();
            }
          })
        }
      >
        {isPending ? "Saving..." : isSuspended ? "Unsuspend user" : "Suspend user"}
      </Button>
    </div>
  );
}
