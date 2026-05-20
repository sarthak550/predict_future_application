/**
 * Admin — Create Flagship Event Poll (S32 follow-up)
 *
 * Power-tool form for admins to create flagship polls directly without going
 * through the regular user moderation queue. Auto-approves on submit.
 *
 * Route: /admin/flagship-events/new
 */

import type { Metadata } from "next";
import Link from "next/link";

import { CreateFlagshipForm } from "@/components/admin/create-flagship-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Create Flagship Poll — Predict Future Admin",
  robots: { index: false, follow: false },
};

export default function NewFlagshipEventPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/flagship-events"
          className="text-sm text-blue-600 hover:text-blue-800 mb-2 inline-block"
        >
          ← Back to all flagship events
        </Link>
        <h1 className="text-2xl font-bold">Create Flagship Poll</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create a poll tied to an upcoming high-impact event. Polls created here are
          auto-approved and immediately visible in the Finance tab carousel.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Poll details</CardTitle>
          <CardDescription>
            For multi-choice polls, list each option on a new line.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateFlagshipForm />
        </CardContent>
      </Card>
    </div>
  );
}
