"use client";

/**
 * Notification bell for PublicHeader's signed-in state (Growth Loop Sprint
 * G2, Decision 2). Self-determines auth state from the unread-count
 * response itself (a 401 means signed out) rather than a separate session
 * fetch — one request answers both "is anyone signed in" and "what's the
 * badge count," so this mounts unconditionally in the header without
 * duplicating SessionChip's own /api/auth/session call.
 *
 * The latest-10 list is fetched lazily on first dropdown open (not on
 * mount) — same "don't pay for what nobody looks at" principle TakeASide's
 * tallies fetch already established for this codebase.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import type { Notification } from "@prisma/client";

import { formatRelativeTime } from "@/lib/utils";

export function NotificationBell() {
  const [signedIn, setSignedIn] = useState(false);
  const [checked, setChecked] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications/unread-count")
      .then((r) => {
        if (cancelled) return;
        if (r.status === 401) {
          setSignedIn(false);
          return;
        }
        setSignedIn(true);
        return r.json();
      })
      .then((data: { count: number } | undefined) => {
        if (!cancelled && data) setUnreadCount(data.count);
      })
      .catch(() => {
        /* offline / transient — leave the bell hidden for this load */
      })
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function fetchList() {
    setListLoading(true);
    fetch("/api/notifications?limit=10")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { notifications: Notification[]; unreadCount: number } | null) => {
        if (!data) return;
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      })
      .catch(() => {
        /* leave whatever list state we already had */
      })
      .finally(() => setListLoading(false));
  }

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && notifications === null) fetchList();
  }

  async function markAllRead() {
    if (markingRead) return;
    setMarkingRead(true);
    try {
      const res = await fetch("/api/notifications", { method: "PATCH" });
      if (res.ok) {
        // Re-fetch rather than optimistically zeroing — confirms the write
        // actually persisted instead of just trusting the click.
        fetchList();
      }
    } catch {
      /* transient — badge stays as-is, user can retry */
    } finally {
      setMarkingRead(false);
    }
  }

  if (!checked || !signedIn) return null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-500 transition hover:bg-ink-50 hover:text-ink-900"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold leading-none text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <p className="text-sm font-semibold text-ink-900">Notifications</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                disabled={markingRead}
                className="text-xs font-medium text-signal-sky hover:underline disabled:opacity-60"
              >
                {markingRead ? "Marking…" : "Mark all read"}
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {listLoading && !notifications ? (
              <p className="px-4 py-6 text-center text-sm text-ink-400">Loading…</p>
            ) : !notifications || notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-400">No notifications yet.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {notifications.map((n) => (
                  <li key={n.id}>
                    <Link
                      href={n.href ?? "/notifications"}
                      onClick={() => setOpen(false)}
                      className={`block px-4 py-3 transition hover:bg-ink-50 ${!n.isRead ? "bg-signal-sky/5" : ""}`}
                    >
                      <div className="flex items-start gap-2">
                        {!n.isRead && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-signal-sky" />}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink-900">{n.title}</p>
                          <p className="line-clamp-2 text-xs text-ink-500">{n.body}</p>
                          <p className="mt-1 text-[11px] text-ink-400">{formatRelativeTime(n.createdAt)}</p>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-ink-100 px-4 py-2.5 text-center text-xs font-medium text-signal-sky hover:underline"
          >
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
