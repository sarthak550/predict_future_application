"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/utils";

type CommentItem = {
  id: string;
  body: string;
  createdAt: Date | string;
  user: {
    username: string;
  };
};

export function CommentsSection({
  marketId,
  comments,
  canComment
}: {
  marketId: string;
  comments: CommentItem[];
  canComment: boolean;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discussion</CardTitle>
        <CardDescription>Debate the forecast, not the person.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {canComment ? (
          <div className="space-y-3">
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Add reasoning, source notes, or counterpoints."
            />
            {error && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}
            <Button
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  setError("");
                  const response = await fetch(`/api/markets/${marketId}/comments`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ body })
                  });
                  const payload = (await response.json()) as { error?: string };
                  if (!response.ok) {
                    setError(payload.error ?? "Unable to add comment.");
                    return;
                  }
                  setBody("");
                  router.refresh();
                })
              }
            >
              {isPending ? "Posting..." : "Post comment"}
            </Button>
          </div>
        ) : (
          <div className="rounded-[24px] bg-ink-50 p-4 text-sm text-ink-600">
            <Link href="/sign-in" className="font-medium text-signal-sky">
              Sign in
            </Link>{" "}
            to join the discussion.
          </div>
        )}

        <div className="space-y-4">
          {comments.map((comment) => (
            <div key={comment.id} className="rounded-[24px] border border-ink-100 bg-white p-4">
              <div className="flex items-center gap-3">
                <Avatar name={comment.user.username} className="h-9 w-9 rounded-xl text-xs" />
                <div>
                  <p className="font-medium text-ink-900">@{comment.user.username}</p>
                  <p className="text-xs text-ink-500">{formatDateTime(comment.createdAt)}</p>
                </div>
              </div>
              <p className="mt-3 text-sm leading-7 text-ink-600">{comment.body}</p>
            </div>
          ))}
          {comments.length === 0 && <p className="text-sm text-ink-500">No comments yet.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
