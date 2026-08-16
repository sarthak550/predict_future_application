"use client";

/**
 * One-tap share action for a call's share card (Growth Loop Sprint G3,
 * Decision 3; extended 2026-08-16). MISS calls are shareable identically to
 * HIT calls — no separate gate or different treatment; the OG image's own
 * "a MISS never reads as punitive" design intent already made this call.
 * PENDING calls are shareable too (founder 2026-08-16: "sharing should also
 * be for PENDING calls") — the honesty law is about COPY, not access: a
 * pending share says "will it land?", never implies a verdict, and both the
 * call page and the OG image render an explicit amber PENDING state
 * (see /calls/[id]/opengraph-image.tsx).
 *
 * navigator.share() is what actually matters here — on mobile web it opens
 * the native OS sheet, which reaches WhatsApp directly, the GTM wedge — but
 * desktop browsers frequently lack it, so the primary button falls back to
 * copy-link there. Either way, two EXPLICIT intent links (WhatsApp, Twitter/X)
 * are always rendered alongside it, never gated behind native-share support.
 *
 * The share URL is built from window.location.origin at share-time, not a
 * hardcoded domain — this app currently serves from
 * predictfuture-web.duckdns.org (predictfuture.app has no DNS record yet,
 * see lib/analytics/featureFlags.ts's doc comment), so hardcoding either one
 * risks shipping a dead link the moment the other becomes canonical.
 * Deriving it from the actual page origin means shared links always work,
 * regardless of which domain served the page.
 */

import { useEffect, useState } from "react";
import { Check, Copy, MessageCircle, Share2, Twitter } from "lucide-react";
import type { OpinionDirection } from "@prisma/client";

const UTM_SUFFIX = "utm_source=predictfuture&utm_medium=share&utm_campaign=call_share";

const DIRECTION_LABELS: Record<OpinionDirection, string> = {
  BULLISH: "Bullish",
  BEARISH: "Bearish",
  NEUTRAL: "Neutral",
};

export function ShareCallButton({
  callId,
  analystName,
  direction,
  instrument,
  resolutionStatus,
}: {
  callId: string;
  analystName: string;
  direction: OpinionDirection;
  instrument: string | null;
  resolutionStatus: "RESOLVED_HIT" | "RESOLVED_MISS" | "PENDING";
}) {
  const [shareUrl, setShareUrl] = useState("");
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setShareUrl(`${window.location.origin}/calls/${callId}?${UTM_SUFFIX}`);
    setCanNativeShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, [callId]);

  const subject = instrument ?? "the market";
  // Factual, non-punitive tone (founder brief, Decision 3) — matches
  // AnalystDisclaimerFooter's voice. No "wrong again," no exclamation-mark
  // spin on a MISS, and a PENDING share never implies a verdict exists.
  const shareText =
    resolutionStatus === "PENDING"
      ? `${analystName} called ${DIRECTION_LABELS[direction]} on ${subject} — will it land? Every call gets graded HIT or MISS →`
      : `${analystName} called ${DIRECTION_LABELS[direction]} on ${subject} — ${resolutionStatus === "RESOLVED_HIT" ? "HIT" : "MISS"}. See the full track record →`;

  async function handlePrimaryAction() {
    if (!shareUrl) return;
    if (canNativeShare) {
      try {
        await navigator.share({ title: "Predict Future — Analyst Scorecard", text: shareText, url: shareUrl });
      } catch {
        // User cancelled the native share sheet — not an error, nothing to do.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the WhatsApp/Twitter links below still work.
    }
  }

  const whatsappHref = shareUrl ? `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}` : undefined;
  const twitterHref = shareUrl
    ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`
    : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handlePrimaryAction}
        disabled={!shareUrl}
        className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3.5 py-1.5 text-sm font-medium text-ink-700 transition hover:border-signal-sky hover:text-signal-sky disabled:cursor-not-allowed disabled:opacity-60"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" />
        ) : canNativeShare ? (
          <Share2 className="h-3.5 w-3.5" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
        {copied ? "Link copied" : canNativeShare ? "Share" : "Copy link"}
      </button>
      <a
        href={whatsappHref ?? undefined}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          if (!whatsappHref) e.preventDefault();
        }}
        className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3.5 py-1.5 text-sm font-medium text-ink-700 transition hover:border-emerald-500 hover:text-emerald-600"
      >
        <MessageCircle className="h-3.5 w-3.5" />
        WhatsApp
      </a>
      <a
        href={twitterHref ?? undefined}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          if (!twitterHref) e.preventDefault();
        }}
        className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3.5 py-1.5 text-sm font-medium text-ink-700 transition hover:border-ink-900 hover:text-ink-900"
      >
        <Twitter className="h-3.5 w-3.5" />
        Post
      </a>
    </div>
  );
}
