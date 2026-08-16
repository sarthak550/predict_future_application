import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Terms of Service | Predict Future",
  description:
    "The terms governing your use of Predict Future — the analyst scorecard and simulated paper-trading product.",
  alternates: { canonical: "https://predictfuture.app/terms" },
  robots: { index: true, follow: true }
};

const LAST_UPDATED = "August 16, 2026";

export default function TermsOfServicePage() {
  return (
    <article className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Terms of Service</h1>
        <p className="mt-2 text-sm text-ink-400">Last updated: {LAST_UPDATED}</p>
      </div>

      <p className="text-sm leading-6 text-ink-600">
        These terms govern your use of Predict Future. By creating an account or using the site, you agree to them.
        We&apos;ve written this in plain language rather than dense legal boilerplate; if a term needs to change as
        the product grows, we&apos;ll update the date above.
      </p>

      <Section title="1. What Predict Future is">
        <p>
          Predict Future is an analyst scorecard: we track what market analysts and commentators say in public
          sources, and grade those calls against what actually happened. It also includes paper trading —
          simulated trading using virtual, non-monetary points against real, delayed market prices.
        </p>
        <p>
          <strong className="font-semibold text-ink-900">
            Nothing on Predict Future is investment advice or a recommendation to buy or sell any security.
          </strong>{" "}
          Analyst opinions shown on the site are aggregated commentary from public sources, presented for
          informational and accountability purposes, sourced back to the original article wherever possible.
        </p>
      </Section>

      <Section title="2. Paper trading is simulated, not real">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Paper-trading balances are virtual points with no real-world monetary value.</li>
          <li>They cannot be purchased, withdrawn, redeemed for cash, or transferred to another person.</li>
          <li>No real securities, options, or futures are ever bought or sold — nothing here is a brokerage account.</li>
          <li>
            Simulated fills use real, delayed market prices with itemized costs estimated at representative
            discount-broker rates, which may not match any specific real broker.
          </li>
          <li>Past simulated performance does not indicate or guarantee future results, real or simulated.</li>
        </ul>
      </Section>

      <Section title="3. Your account">
        <p>
          In production, accounts are created and accessed by signing in with Google — you&apos;re responsible for
          keeping your Google account secure. In development/testing environments only, an email-and-password path
          may also be available. Each person may hold one account. You&apos;re responsible for activity that occurs
          under your account.
        </p>
      </Section>

      <Section title="4. Acceptable use">
        <p>You agree not to:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Impersonate another person or misrepresent your affiliation with anyone.</li>
          <li>Attempt to bypass rate limits, authentication, or other security controls.</li>
          <li>Scrape, automate, or systematically extract data from the site outside of any API we explicitly offer.</li>
          <li>Use the service for anything unlawful, or that infringes anyone else&apos;s rights.</li>
        </ul>
      </Section>

      <Section title="5. Suspension and termination">
        <p>
          We may suspend or terminate an account that violates these terms, including suspected abuse, manipulation
          of paper-trading mechanics, or unlawful activity. Where practical, we&apos;ll tell you why.
        </p>
      </Section>

      <Section title="6. No warranties; limitation of liability">
        <p>
          The service is provided &quot;as is,&quot; without warranties of any kind. Market data, grading of
          analyst calls, and simulated trading fills are provided on a best-effort basis and may contain errors or
          delays. To the fullest extent permitted by law, Predict Future is not liable for any losses — including
          decisions made based on information shown on the site — arising from your use of the service.
        </p>
      </Section>

      <Section title="7. Changes to these terms">
        <p>
          We may update these terms as the product evolves. Continuing to use the site after an update means you
          accept the revised terms.
        </p>
      </Section>

      <Section title="8. Governing law">
        <p>These terms are governed by the laws of India.</p>
      </Section>

      <Section title="9. Contact">
        <p>
          Questions about these terms:{" "}
          <a href="mailto:support@predictfuture.app" className="text-signal-sky underline underline-offset-2">
            support@predictfuture.app
          </a>
          .
        </p>
      </Section>

      <p className="text-sm text-ink-400">
        See also our <Link href="/privacy" className="text-signal-sky underline underline-offset-2">Privacy Policy</Link>.
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
