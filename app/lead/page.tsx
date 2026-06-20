"use client";

import Link from "next/link";
import type { Route } from "next";
import { PhoneFrame } from "@/components/lead/PhoneFrame";
import { useLead } from "@/components/lead/LeadProvider";
import { useRouter } from "next/navigation";

const STEP_BG = {
  1: "var(--teal)",
  2: "var(--teal-bright)",
  3: "var(--coral)",
} as const;

export default function LeadLandingPage() {
  const { ensureRun } = useLead();
  const router = useRouter();

  return (
    <PhoneFrame>
      {/* atmospheric blobs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-14 z-0 h-60 w-60 rounded-full opacity-50 blur-md"
        style={{
          background: "radial-gradient(circle,#9DECE4,transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-20 bottom-28 z-0 h-52 w-52 rounded-full opacity-60 blur-md"
        style={{
          background: "radial-gradient(circle,#FFD2C4,transparent 70%)",
        }}
      />

      {/* top bar (phone-frame only — desktop has its own header) */}
      <div className="relative z-10 flex items-center justify-between px-[26px] pt-10 lg:hidden">
        <div className="flex items-center gap-2.5">
          <div
            className="lead-display flex h-[30px] w-[30px] items-center justify-center rounded-[9px] text-[17px] font-extrabold text-white shadow-[0_6px_14px_-4px_rgba(13,148,136,0.6)]"
            style={{
              background:
                "linear-gradient(140deg,var(--teal-bright),var(--teal-deep))",
            }}
          >
            L
          </div>
          <div className="lead-display text-[18px] font-bold tracking-tight">
            LEAD
          </div>
        </div>
        <div
          className="rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-[var(--teal-deep)]"
          style={{ background: "#D7F2EE" }}
        >
          ≈ 15 min
        </div>
      </div>

      {/* hero */}
      <div className="relative z-10 flex flex-1 flex-col px-[26px] pt-[18px] lg:flex-row lg:items-center lg:gap-16 lg:px-10 lg:pt-20">
        <div className="lg:flex-1">
          <div className="mb-5 inline-flex items-center gap-2 text-[12.5px] font-semibold text-[var(--teal-deep)] lg:text-[14px]">
            <span
              className="h-[7px] w-[7px] rounded-full"
              style={{
                background: "var(--coral)",
                boxShadow: "0 0 0 4px rgba(255,107,74,.18)",
              }}
            />
            Your college-readiness check
          </div>

          <h1 className="lead-display mb-4 text-[40px] font-extrabold leading-[1.02] tracking-[-0.025em] lg:text-[64px] lg:leading-[1.04]">
            Get ready for a{" "}
            <span className="whitespace-nowrap text-[var(--teal)]">
              great college.
            </span>
          </h1>
          <p className="max-w-[300px] text-[16.5px] font-medium leading-[1.5] text-[var(--slate)] lg:max-w-[480px] lg:text-[19px]">
            A quick check that shows where you stand — and how to stand out.
          </p>

          {/* desktop CTA, inline with hero */}
          <div className="mt-7 hidden lg:block">
            <button
              type="button"
              onClick={async () => {
                await ensureRun();
                router.push("/lead/consent" as Route);
              }}
              className="lead-cta inline-flex text-[17px]"
              style={{ paddingLeft: 28, paddingRight: 28 }}
            >
              Start free <span className="text-[19px]">→</span>
            </button>
            <div className="mt-5 flex items-center gap-5 text-[13px] font-medium text-[var(--slate)]">
              <Trust>Free</Trust>
              <Trust>Private by choice</Trust>
              <Trust>15 minutes</Trust>
            </div>
            <Link
              href="/login"
              className="mt-4 inline-block text-[13px] font-medium text-[var(--slate)] no-underline hover:text-[var(--teal-deep)]"
            >
              Already have an account? Sign in →
            </Link>
          </div>
        </div>

        {/* zig-zag flow */}
        <div className="mt-[18px] flex flex-1 flex-col justify-center lg:mt-0 lg:max-w-[460px]">
          <Step n={1} title="Watch" desc="A video" align="left" />
          <Connector dir="right" />
          <Step n={2} title="Present" desc="Share your take" align="right" />
          <Connector dir="left" />
          <Step n={3} title="Q&A" desc="A quick back-and-forth" align="left" />
        </div>
      </div>

      {/* phone-frame footer */}
      <div className="relative z-10 px-[26px] pb-7 pt-5 lg:hidden">
        <button
          type="button"
          onClick={async () => {
            await ensureRun();
            router.push("/lead/consent" as Route);
          }}
          className="lead-cta w-full text-[17px]"
        >
          Start free <span className="text-[19px]">→</span>
        </button>
        <div className="mt-4 flex items-center justify-center gap-4 text-xs font-medium text-[var(--slate)]">
          <Trust>Free</Trust>
          <Trust>Private by choice</Trust>
          <Trust>15 minutes</Trust>
        </div>
        <Link
          href="/login"
          className="mt-3 block text-center text-[12px] font-medium text-[var(--slate)] no-underline hover:text-[var(--teal-deep)]"
        >
          Already have an account? Sign in
        </Link>
      </div>
    </PhoneFrame>
  );
}

function Step({
  n,
  title,
  desc,
  align,
}: {
  n: 1 | 2 | 3;
  title: string;
  desc: string;
  align: "left" | "right";
}) {
  return (
    <div
      className={`flex w-[64%] items-center gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-3 shadow-[0_12px_26px_-16px_rgba(13,148,136,0.5)] ${
        align === "left" ? "self-start" : "self-end"
      }`}
    >
      <div
        className="lead-display flex h-9 w-9 flex-none items-center justify-center rounded-xl text-[17px] font-extrabold text-white"
        style={{ background: STEP_BG[n] }}
      >
        {n}
      </div>
      <div>
        <div className="text-[15.5px] font-bold leading-[1.1] text-[var(--ink)]">
          {title}
        </div>
        <div className="mt-0.5 text-[11.5px] leading-[1.2] text-[var(--slate)]">
          {desc}
        </div>
      </div>
    </div>
  );
}

function Connector({ dir }: { dir: "left" | "right" }) {
  return (
    <div className="flex h-8 items-center justify-center">
      <svg
        width="150"
        height="34"
        viewBox="0 0 150 34"
        fill="none"
        style={{ transform: dir === "left" ? "scaleX(-1)" : undefined }}
      >
        <path
          d="M22 6 Q 84 4 124 28"
          stroke="var(--teal-bright)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray="1.5 7"
        />
        <path
          d="M124 28 L112 22 M124 28 L116 34"
          stroke="var(--teal-bright)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
}

function Trust({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-extrabold text-[var(--teal)]">✓</span>
      {children}
    </span>
  );
}
