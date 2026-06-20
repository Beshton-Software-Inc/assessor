"use client";

import Link from "next/link";
import { PhoneFrame } from "@/components/lead/PhoneFrame";
import { useLead } from "@/components/lead/LeadProvider";

export default function LeadDonePage() {
  const { run } = useLead();
  const firstName = run?.firstName ?? "friend";

  return (
    <PhoneFrame>
      {/* atmospheric blobs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-14 -top-12 h-52 w-52 rounded-full opacity-50 blur-md"
        style={{
          background: "radial-gradient(circle,#9DECE4,transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-16 top-16 h-44 w-44 rounded-full opacity-50 blur-md"
        style={{
          background: "radial-gradient(circle,#FFD2C4,transparent 70%)",
        }}
      />

      <div
        className="relative z-10 flex-1 overflow-y-auto px-[22px] pb-4 pt-7 lg:overflow-visible lg:px-10 lg:pb-12 lg:pt-12"
        style={{ scrollbarWidth: "none" }}
      >
        <h1 className="lead-display mb-1 text-[27px] font-extrabold leading-[1.05] tracking-[-0.02em] lg:text-[42px]">
          You&apos;re all set, {firstName} 🎉
        </h1>
        <p className="mb-3 text-[13.5px] font-medium leading-[1.4] text-[var(--slate)] lg:mb-8 lg:text-[16px]">
          Here&apos;s how to keep building toward your goal.
        </p>

        <div className="lg:grid lg:grid-cols-[1.1fr_1fr] lg:gap-8">
        <div
          className="mb-2.5 rounded-[20px] p-4 text-white shadow-[0_20px_40px_-18px_rgba(15,118,110,0.7)] lg:mb-0 lg:p-6"
          style={{
            background: "linear-gradient(140deg,#14B8A6,#0F766E 60%,#0B2B29)",
          }}
        >
          <span className="mb-2.5 inline-block rounded-full bg-white/20 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider">
            Free · 30 min · 1-on-1
          </span>
          <h2 className="lead-display mb-1.5 text-[18px] font-extrabold leading-[1.15]">
            A free 30-min session with a college adviser
          </h2>
          <p className="mb-3 text-[12.5px] leading-[1.4] text-white/85">
            A vetted adviser walks you through your plan one-on-one — no
            pressure.
          </p>
          <button
            type="button"
            className="w-full rounded-[14px] bg-white py-3 text-[15px] font-bold text-[var(--teal-deep)] transition-transform hover:-translate-y-px"
          >
            Book my free 30-min session →
          </button>
        </div>

        <div className="lg:flex lg:flex-col lg:gap-2.5">
        <Card icon="🎯" title="Your growth plan" subtitle="4 goals to grow">
          <Goal emoji="🧠" text="Stress-test your own arguments" tag="Critical Thinking" />
          <Goal emoji="🗣️" text="Swap fillers for pauses" tag="Communication" />
          <Goal emoji="🧭" text="Lead with a bolder vision" tag="Leadership" />
          <Goal emoji="🎓" text="Write a vulnerable, honest story" tag="Reflection" />
          <Link
            href="/student"
            className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] font-bold text-[var(--coral-dark)] no-underline"
          >
            View full plan with steps &amp; deadlines →
          </Link>
        </Card>

        <Card
          icon="💬"
          title="Know someone applying?"
          subtitle="Share LEAD — it's free for them too."
        >
          <button
            type="button"
            onClick={() => {
              if (typeof navigator === "undefined") return;
              if (navigator.share) {
                void navigator.share({
                  title: "LEAD — your college-readiness check",
                  url: window.location.origin + "/lead",
                });
              } else {
                void navigator.clipboard?.writeText(
                  window.location.origin + "/lead",
                );
              }
            }}
            className="flex w-full items-center justify-center gap-2 rounded-[13px] border-[1.5px] border-[var(--teal)] bg-white py-3 text-[14px] font-bold text-[var(--teal-deep)] transition-colors hover:bg-[#EAF6F4]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
            </svg>
            Share my link
          </button>
        </Card>

        <Link
          href="/student"
          className="mt-1 block px-2 py-2 text-center text-[13px] font-semibold text-[var(--slate)] no-underline lg:mt-2"
        >
          Back to my dashboard
        </Link>
        </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

function Card({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-3.5 shadow-[0_10px_24px_-18px_rgba(13,148,136,0.5)]">
      <div className="mb-2.5 flex items-center gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl text-lg"
          style={{ background: "#EAF6F4" }}
        >
          {icon}
        </div>
        <div>
          <b className="lead-display text-[16px] font-extrabold text-[var(--ink)]">
            {title}
          </b>
          <small className="mt-0.5 block text-[11.5px] font-medium text-[var(--slate)]">
            {subtitle}
          </small>
        </div>
      </div>
      {children}
    </div>
  );
}

function Goal({
  emoji,
  text,
  tag,
}: {
  emoji: string;
  text: string;
  tag: string;
}) {
  return (
    <div className="flex items-center gap-2.5 border-t border-[var(--line)] py-1.5 first:border-t-0">
      <span className="text-[15px]">{emoji}</span>
      <span className="flex-1 text-[13px] font-semibold text-[var(--ink)]">
        {text}
      </span>
      <span
        className="rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--teal-deep)]"
        style={{ background: "#EAF6F4" }}
      >
        {tag}
      </span>
    </div>
  );
}
