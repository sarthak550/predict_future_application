import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Privacy Policy | Predict Future",
  description:
    "What Predict Future collects when you sign in with Google, how it's used, and how to request access, correction, or deletion of your data.",
  alternates: { canonical: "https://predictfuture.app/privacy" },
  robots: { index: true, follow: true }
};

const LAST_UPDATED = "August 16, 2026";

export default function PrivacyPolicyPage() {
  return (
    <article className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Privacy Policy</h1>
        <p className="mt-2 text-sm text-ink-400">Last updated: {LAST_UPDATED}</p>
      </div>

      <p className="text-sm leading-6 text-ink-600">
        This page explains what Predict Future ("we," "us") collects when you use the site, why, and what choices
        you have. We&apos;ve kept it short and honest rather than padded with boilerplate. If anything here is
        unclear, contact us using the details at the bottom.
      </p>

      <Section title="1. Information we collect">
        <p>
          <strong className="font-semibold text-ink-900">When you sign in with Google</strong> — the only production
          sign-in method — Google shares your name, email address, and profile picture with us, and confirms your
          email is verified. We don&apos;t receive your Google password or see anything else in your Google account.
        </p>
        <p>
          <strong className="font-semibold text-ink-900">In development/testing environments only</strong>, an
          email-and-password sign-up path may be available. If you use it, we store your username, email address,
          and a bcrypt hash of your password — never the password itself in readable form. This path is disabled in
          production.
        </p>
        <p>
          <strong className="font-semibold text-ink-900">Usage data</strong> — pages you visit, features you use
          (paper-trading orders and positions, watchlists, saved opinions, notification interactions), and standard
          request metadata (approximate timestamps, browser/device information). Paper trading uses simulated
          virtual currency against real, delayed market prices — no real money or brokerage account is ever
          involved, so we never collect real payment or bank details for it.
        </p>
        <p>We do not knowingly collect information from anyone under 18.</p>
      </Section>

      <Section title="2. How we use it">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>To create, secure, and identify your account.</li>
          <li>
            To operate the product you signed up for: your virtual wallet balance, paper-trading positions and
            history, watchlists, saved analyst opinions, and notifications.
          </li>
          <li>To detect and prevent abuse (for example, rate-limiting repeated failed sign-in attempts).</li>
          <li>To understand, in aggregate, which parts of the product are actually used, so we can improve it.</li>
        </ul>
      </Section>

      <Section title="3. What we don't do">
        <p>
          We do not sell your personal data, and we do not use it to serve third-party advertising. We do not share
          your data with anyone except as described below.
        </p>
      </Section>

      <Section title="4. Who we share data with">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="font-semibold text-ink-900">Google</strong>, when you choose to sign in with Google —
            governed by{" "}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-signal-sky underline underline-offset-2"
            >
              Google&apos;s own privacy policy
            </a>
            .
          </li>
          <li>
            Infrastructure providers (our database and hosting services) that process data strictly on our behalf,
            solely to run the product — they don&apos;t get to use your data for their own purposes.
          </li>
          <li>If required to by law, or to protect the rights, safety, or property of Predict Future or our users.</li>
        </ul>
      </Section>

      <Section title="5. Cookies and sessions">
        <p>
          We use a single session cookie to keep you signed in. We don&apos;t use third-party advertising or
          cross-site tracking cookies.
        </p>
      </Section>

      <Section title="6. Data retention">
        <p>
          We retain account data for as long as your account is active. If you want your account and associated
          data deleted, contact us and we&apos;ll process the request.
        </p>
      </Section>

      <Section title="7. Your rights">
        <p>
          You can ask us to access, correct, or delete your personal data at any time by contacting us below. If you
          signed up in a development/testing environment with a password, that password is stored as a bcrypt hash
          and is never visible to us in plain text.
        </p>
      </Section>

      <Section title="8. Changes to this policy">
        <p>
          We may update this policy as the product changes. Material changes will update the &quot;Last
          updated&quot; date above.
        </p>
      </Section>

      <Section title="9. Contact">
        <p>
          Questions about this policy or your data:{" "}
          <a href="mailto:support@predictfuture.app" className="text-signal-sky underline underline-offset-2">
            support@predictfuture.app
          </a>
          .
        </p>
      </Section>

      <p className="text-sm text-ink-400">
        See also our <Link href="/terms" className="text-signal-sky underline underline-offset-2">Terms of Service</Link>.
      </p>
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
      <div className="space-y-3 text-sm leading-6 text-ink-600">{children}</div>
    </section>
  );
}
