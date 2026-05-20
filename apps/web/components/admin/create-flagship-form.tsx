"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

const EVENT_TYPE_OPTIONS = [
  { value: "RBI", label: "RBI MPC" },
  { value: "BUDGET", label: "Union Budget" },
  { value: "GST", label: "GST Council" },
  { value: "GLOBAL", label: "Global event" },
  { value: "FED", label: "US Fed" },
  { value: "OTHER", label: "Other" },
];

function defaultDateInputValue(): string {
  // Two weeks from now in local time, YYYY-MM-DDTHH:MM
  const d = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CreateFlagshipForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [marketType, setMarketType] = useState<"BINARY" | "MULTIPLE_CHOICE">("BINARY");
  const [optionsText, setOptionsText] = useState("No change\nCut 25bps\nCut 50bps");
  const [flagshipDate, setFlagshipDate] = useState(defaultDateInputValue());
  const [flagshipType, setFlagshipType] = useState("RBI");
  const [sourceName, setSourceName] = useState("RBI Official Press Release");
  const [ruleText, setRuleText] = useState("Resolves based on the official RBI MPC announcement.");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const options = optionsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    if (marketType === "MULTIPLE_CHOICE" && (options.length < 2 || options.length > 10)) {
      setMessage("Multi-choice polls need 2–10 options (one per line).");
      return;
    }
    if (title.trim().length < 10) {
      setMessage("Title must be at least 10 characters.");
      return;
    }

    // Convert local datetime-local input to ISO
    const flagshipISO = new Date(flagshipDate).toISOString();

    startTransition(async () => {
      const res = await fetch("/api/admin/flagship-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          marketType,
          options: marketType === "MULTIPLE_CHOICE" ? options : undefined,
          flagshipEventAt: flagshipISO,
          flagshipEventType: flagshipType,
          resolutionSourceName: sourceName.trim(),
          resolutionRuleText: ruleText.trim(),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage("✓ Flagship poll created.");
        router.push("/admin/flagship-events");
        router.refresh();
      } else {
        setMessage(payload?.error ?? "Failed to create poll.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Will RBI cut the repo rate at the June MPC meeting?"
          className="w-full rounded border px-3 py-2 text-sm"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Description (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add context — economic backdrop, what's at stake, key indicators to watch."
          className="w-full rounded border px-3 py-2 text-sm"
          rows={3}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Poll type</label>
          <select
            value={marketType}
            onChange={(e) => setMarketType(e.target.value as "BINARY" | "MULTIPLE_CHOICE")}
            className="w-full rounded border px-3 py-2 text-sm"
          >
            <option value="BINARY">YES / NO</option>
            <option value="MULTIPLE_CHOICE">Multiple choice</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Event type</label>
          <select
            value={flagshipType}
            onChange={(e) => setFlagshipType(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          >
            {EVENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {marketType === "MULTIPLE_CHOICE" && (
        <div>
          <label className="block text-sm font-medium mb-1">Options (one per line, 2–10)</label>
          <textarea
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm font-mono"
            rows={5}
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">Event date &amp; time (poll closes at this moment)</label>
        <input
          type="datetime-local"
          value={flagshipDate}
          onChange={(e) => setFlagshipDate(e.target.value)}
          className="w-full rounded border px-3 py-2 text-sm"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Resolution source name</label>
          <input
            type="text"
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Resolution rule</label>
          <input
            type="text"
            value={ruleText}
            onChange={(e) => setRuleText(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </div>
      </div>

      {message && (
        <p className={`text-sm ${message.startsWith("✓") ? "text-green-700" : "text-red-700"}`}>{message}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? "Creating..." : "Create flagship poll"}
        </Button>
      </div>
    </form>
  );
}
