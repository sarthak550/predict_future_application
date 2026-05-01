import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Join Group — Predict Future",
  description: "Open this link in the Predict Future app to join the group.",
};

/**
 * Public web stub for group invite deep links.
 *
 * URL shape: https://predictfuture.app/join/<inviteCode>
 *
 * Purpose: when a group invite link is shared outside the app (SMS, email,
 * social), recipients land here. The page prompts them to open or install
 * the app and provides the deep link `predictfuture://join/<inviteCode>`.
 * It does not require auth and has no dependency on the API — it is a
 * lightweight redirect page.
 */
export default async function JoinGroupWebStubPage({
  params,
}: {
  params: { inviteCode: string };
}) {
  const { inviteCode } = params;
  const deepLink = `predictfuture://join/${inviteCode}`;
  const appStoreUrl = "https://apps.apple.com/app/predict-future/id0000000000";

  return (
    <div className="min-h-screen bg-[#f5f7fb] flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-sm text-center">
        {/* Icon */}
        <div className="w-16 h-16 bg-sky-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#0EA5E9"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </div>

        <h1 className="text-xl font-bold text-gray-900 mb-2">
          You&apos;ve been invited to a group
        </h1>
        <p className="text-sm text-gray-500 mb-6 leading-relaxed">
          Open the Predict Future app to see the group details and join with
          one tap.
        </p>

        {/* Primary CTA — open in app */}
        <a
          href={deepLink}
          className="block w-full bg-sky-500 hover:bg-sky-600 text-white font-semibold py-3 px-6 rounded-full transition-colors mb-3 text-sm"
        >
          Open in Predict Future App
        </a>

        {/* Secondary — App Store */}
        <a
          href={appStoreUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full border border-gray-200 hover:border-gray-300 text-gray-600 font-medium py-3 px-6 rounded-full transition-colors text-sm"
        >
          Download the App
        </a>

        {/* Invite code hint */}
        <p className="mt-5 text-xs text-gray-400">
          Invite code:{" "}
          <span className="font-mono font-semibold text-gray-500">
            {inviteCode}
          </span>
        </p>

        {/* Back to site */}
        <div className="mt-5 border-t border-gray-100 pt-4">
          <Link
            href="/"
            className="text-xs text-sky-500 hover:text-sky-600 font-medium"
          >
            Learn more about Predict Future
          </Link>
        </div>
      </div>
    </div>
  );
}
