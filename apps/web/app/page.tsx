import Link from "next/link";
import { ArrowRight, BadgeCheck, Flame, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <Header />

      <main className="mx-auto max-w-6xl px-4 pb-20 pt-12 sm:px-6 lg:px-8 lg:pt-20">
        <Hero />
        <HowItWorks />
        <TrustNote />
        <BottomCta />
      </main>

      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-4 pt-6 sm:px-6 lg:px-8">
      <Link href="/" className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink-900 text-sm font-semibold text-white">
          PF
        </div>
        <span className="text-base font-semibold tracking-tight text-ink-900">Predict Future</span>
      </Link>
      <div className="flex items-center gap-2">
        <Link href="/sign-in">
          <Button variant="ghost" size="sm">
            Sign in
          </Button>
        </Link>
        <Link href="/sign-up">
          <Button size="sm">Get started</Button>
        </Link>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-6">
        <span className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1 text-xs font-medium text-ink-600">
          <Sparkles className="h-3.5 w-3.5 text-signal-sky" />
          Play-money only — no deposits, no risk
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl lg:text-6xl">
          Read the news. <br className="hidden sm:block" />
          Predict what happens next.
        </h1>
        <p className="max-w-xl text-lg leading-8 text-ink-600">
          Scroll through short-form stories, pick YES or NO on the attached question, and climb the
          accuracy leaderboard. It takes about ten seconds to start.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href="/sign-up">
            <Button size="lg">
              Start predicting — free
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/feed">
            <Button variant="secondary" size="lg">
              Peek at the feed
            </Button>
          </Link>
        </div>
      </div>

      <StoryPreview />
    </section>
  );
}

function StoryPreview() {
  return (
    <div className="relative overflow-hidden rounded-[32px] bg-ink-900 p-6 text-white shadow-glow sm:p-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.28),_transparent_55%)]" />
      <div className="relative space-y-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-white/60">
          <span className="h-2 w-2 rounded-full bg-signal-teal" />
          Sports · 2m ago
        </div>
        <h3 className="text-2xl font-semibold leading-tight sm:text-3xl">
          Will India win tomorrow&rsquo;s match in Mumbai?
        </h3>
        <p className="text-sm leading-7 text-white/70">
          Both teams named unchanged lineups after the morning session. Crowd is leaning YES so far.
        </p>

        <div className="rounded-2xl bg-white/10 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium text-white/80">YES</span>
            <span className="text-lg font-semibold">68%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-[68%] rounded-full bg-gradient-to-r from-signal-teal to-signal-sky" />
          </div>
          <div className="mt-2 flex justify-between text-xs text-white/60">
            <span>247 predictions</span>
            <span>Closes in 18h</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      num: "1",
      title: "Scroll a story",
      body: "One headline per screen. A short summary. The source link, if you want to dig deeper."
    },
    {
      num: "2",
      title: "Make the call",
      body: "Pick YES or NO. Spend a few virtual points. Watch the crowd probability move in real time."
    },
    {
      num: "3",
      title: "Climb the rank",
      body: "When the story resolves, correct calls earn points, streaks, and a higher accuracy rank."
    }
  ];

  return (
    <section className="mt-24">
      <div className="mb-10 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal-sky">How it works</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
          Three steps. No spreadsheets.
        </h2>
      </div>
      <ol className="grid gap-5 lg:grid-cols-3">
        {steps.map((step) => (
          <li
            key={step.num}
            className="rounded-3xl border border-white/70 bg-white/80 p-6 backdrop-blur"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink-900 text-sm font-semibold text-white">
              {step.num}
            </div>
            <h3 className="mt-5 text-lg font-semibold text-ink-900">{step.title}</h3>
            <p className="mt-2 text-sm leading-7 text-ink-600">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TrustNote() {
  return (
    <section className="mt-16 flex items-start gap-4 rounded-3xl border border-ink-200 bg-white p-6 sm:items-center">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-signal-teal/10 text-signal-teal">
        <BadgeCheck className="h-5 w-5" />
      </div>
      <div>
        <p className="font-semibold text-ink-900">Virtual points only.</p>
        <p className="mt-1 text-sm leading-6 text-ink-600">
          No deposits, no withdrawals, no cash conversion. The reward is rank, streak, and reputation —
          never money.
        </p>
      </div>
    </section>
  );
}

function BottomCta() {
  return (
    <section className="mt-20 overflow-hidden rounded-[32px] bg-ink-900 px-6 py-14 text-center text-white sm:px-12 sm:py-16">
      <div className="mx-auto max-w-2xl space-y-5">
        <Flame className="mx-auto h-7 w-7 text-signal-amber" />
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Think you read the news better than most?
        </h2>
        <p className="text-base leading-7 text-white/70">
          Prove it. Start with free points — the only thing on the line is your rank.
        </p>
        <div className="flex justify-center pt-2">
          <Link href="/sign-up">
            <Button size="lg">
              Create your account
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-ink-200 bg-white/60">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-ink-500 sm:px-6 lg:px-8">
        <p>© {new Date().getFullYear()} Predict Future — play-money prediction platform.</p>
        <div className="flex items-center gap-5">
          <Link href="/feed" className="hover:text-ink-900">
            Feed
          </Link>
          <Link href="/markets" className="hover:text-ink-900">
            Markets
          </Link>
          <Link href="/leaderboard" className="hover:text-ink-900">
            Leaderboard
          </Link>
        </div>
      </div>
    </footer>
  );
}
