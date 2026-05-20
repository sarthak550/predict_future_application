"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

const EVENT_TYPE_OPTIONS = [
  { value: "RBI", label: "RBI MPC" },
  { value: "BUDGET", label: "Budget" },
  { value: "GST", label: "GST Council" },
  { value: "GLOBAL", label: "Global" },
  { value: "FED", label: "Fed" },
  { value: "OTHER", label: "Other" },
];

/**
 * Inline form to set or clear the flagship event designation on a market.
 * Used on the /admin/flagship-events page.
 */
export function MarkFlagshipForm({
  marketId,
  currentFlagshipEventAt,
  currentFlagshipEventType,
}: {
  marketId: string;
  currentFlagshipEventAt: Date | null;
  currentFlagshipEventType: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");

  // Form field state
  const [eventAt, setEventAt] = useState(
    currentFlagshipEventAt
      ? currentFlagshipEventAt.toISOString().slice(0, 16)
      : ""
  );
  const [eventType, setEventType] = useState(currentFlagshipEventType ?? "RBI");

  function handleSave() {
    startTransition(async () => {
      const body = {
        flagshipEventAt: eventAt ? new Date(eventAt).toISOString() : null,
        flagshipEventType: eventAt ? eventType : null,
      };

      const response = await fetch(`/api/admin/markets/${marketId}/mark-flagship`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = (await response.json()) as { error?: string };
      if (response.ok) {
        setMessage("Saved.");
        setEditing(false);
        router.refresh();
      } else {
        setMessage(payload.error ?? "Action failed.");
      }
    });
  }

  function handleClear() {
    startTransition(async () => {
      const response = await fetch(`/api/admin/markets/${marketId}/mark-flagship`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagshipEventAt: null, flagshipEventType: null }),
      });

      const payload = (await response.json()) as { error?: string };
      if (response.ok) {
        setMessage("Cleared.");
        setEditing(false);
        router.refresh();
      } else {
        setMessage(payload.error ?? "Action failed.");
      }
    });
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
          Edit Flagship
        </Button>
        {currentFlagshipEventAt && (
          <Button size="sm" variant="secondary" disabled={isPending} onClick={handleClear}>
            {isPending ? "Clearing..." : "Clear"}
          </Button>
        )}
        {message && <span className="text-xs text-ink-500">{message}</span>}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-[12px] border border-amber-200 bg-amber-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-semibold text-ink-700">Event date &amp; time (UTC)</label>
        <input
          type="datetime-local"
          value={eventAt}
          onChange={(e) => setEventAt(e.target.value)}
          className="rounded border border-ink-200 px-2 py-1 text-xs"
          min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-semibold text-ink-700">Event type</label>
        <select
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          className="rounded border border-ink-200 px-2 py-1 text-xs"
        >
          {EVENT_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={isPending || !eventAt} onClick={handleSave}>
          {isPending ? "Saving..." : "Save"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => { setEditing(false); setMessage(""); }}>
          Cancel
        </Button>
        {message && <span className="text-xs text-red-600">{message}</span>}
      </div>
    </div>
  );
}
