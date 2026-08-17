"use client";

/**
 * Session-aware "Create your portfolio" CTA for the /portfolios directory
 * header. Same client-side session-fetch pattern as SessionChip/FollowExpertButton
 * (this page is ISR, so signed-in state can't be read server-side without
 * killing the revalidate window) — a signed-out visitor is routed through
 * /sign-in with a callbackUrl back to /portfolios/new; a signed-in visitor
 * goes straight there.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export function CreatePortfolioCta() {
  const [checked, setChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!cancelled) setSignedIn(Boolean(s?.user));
      })
      .catch(() => {
        /* offline / signed-out — leave signedIn false */
      })
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const href = checked && signedIn ? "/portfolios/new" : "/sign-in?callbackUrl=%2Fportfolios%2Fnew";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {checked && signedIn && (
        <Link href="/portfolios/manage">
          <Button variant="secondary">My portfolios</Button>
        </Link>
      )}
      <Link href={href}>
        <Button variant="primary">Create your portfolio</Button>
      </Link>
    </div>
  );
}
