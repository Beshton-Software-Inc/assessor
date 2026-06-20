"use client";

import { useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { PhoneFrame } from "@/components/lead/PhoneFrame";
import { ProgressHeader } from "@/components/lead/ProgressHeader";
import { SignaturePad } from "@/components/lead/SignaturePad";
import { useLead } from "@/components/lead/LeadProvider";

const TERMS_VERSION = "1";

export default function LeadConsentPage() {
  const router = useRouter();
  const { ensureRun, patchRun } = useLead();
  const [age, setAge] = useState<"over_18" | "under_18">("over_18");
  const [hasSignature, setHasSignature] = useState(false);
  const [agreed, setAgreed] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const canContinue =
    agreed && (age === "over_18" || hasSignature) && !submitting;

  async function onContinue() {
    setSubmitting(true);
    try {
      await ensureRun();
      await patchRun({
        ageBand: age,
        consent: true,
        termsVersion: TERMS_VERSION,
        // For MVP: parental signature is captured client-side only as
        // proof-of-presence; we record a sentinel string. A later iteration
        // could upload the canvas dataURL to storage.
        parentalSignatureUrl: age === "under_18" ? "in-app" : null,
      });
      router.push("/lead/watch" as Route);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PhoneFrame>
      <ProgressHeader step={1} back="/lead" />

      <div
        className="flex-1 overflow-y-auto px-[26px] pb-2 pt-4 lg:overflow-visible lg:px-10 lg:pt-10"
        style={{ scrollbarWidth: "none" }}
      >
        <div className="lg:grid lg:grid-cols-[1.1fr_1fr] lg:gap-12">
        <div>
        <h1 className="lead-display mb-1 text-[25px] font-extrabold leading-[1.08] tracking-[-0.02em] lg:text-[40px]">
          Before we begin
        </h1>
        <p className="mb-4 text-[14px] font-medium leading-[1.45] text-[var(--slate)] lg:text-[16px]">
          Here&apos;s what happens and how your info is handled.
        </p>

        <div className="mb-4 flex flex-col gap-2.5 lg:gap-3.5">
          <Row
            icon="🎥"
            title="We record your session"
            desc="Your video and audio are captured so we can review your reasoning."
          />
          <Row
            icon="💬"
            title="Computer-guided Q&A"
            desc="It adapts to your answers — no human listening in live."
          />
          <Row
            icon="📊"
            title="You get a readiness report"
            desc="The computer scores key areas and gives you tips to grow."
          />
          <Row
            icon="🔒"
            title="Private by choice"
            desc="Your results are yours. You can decline sharing later."
          />
        </div>
        </div>

        <div className="lg:flex lg:flex-col lg:gap-3 lg:pt-1">
        <div className="mb-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3 shadow-[0_8px_22px_-18px_rgba(13,148,136,0.5)] lg:mb-0 lg:p-4">
          <div className="mb-2 text-[13.5px] font-bold">How old are you?</div>
          <div className="flex gap-2">
            <Toggle on={age === "over_18"} onClick={() => setAge("over_18")}>
              I&apos;m 18 or older
            </Toggle>
            <Toggle on={age === "under_18"} onClick={() => setAge("under_18")}>
              I&apos;m under 18
            </Toggle>
          </div>
          {age === "under_18" && (
            <div className="mt-3.5 border-t border-dashed border-[var(--line)] pt-3.5">
              <div className="mb-2 text-xs font-semibold text-[var(--slate)]">
                Parent / guardian signature — sign below to consent
              </div>
              <SignaturePad onChange={setHasSignature} />
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setAgreed((v) => !v)}
          className="flex w-full items-start gap-2.5 rounded-[13px] border border-[var(--line)] bg-[var(--card)] p-3 text-left lg:p-4"
        >
          <span
            className={`flex h-[21px] w-[21px] flex-none items-center justify-center rounded-md border-2 text-xs font-extrabold transition-colors ${
              agreed
                ? "border-[var(--teal)] bg-[var(--teal)] text-white"
                : "border-[var(--teal)] bg-white text-transparent"
            }`}
          >
            ✓
          </span>
          <span className="text-[12px] leading-[1.4] text-[var(--slate)] lg:text-[13px]">
            I agree my session will be recorded to create my results.
          </span>
        </button>

        {/* Desktop: CTA inline at the bottom of the right column */}
        <div className="mt-4 hidden lg:block">
          <button
            type="button"
            onClick={onContinue}
            disabled={!canContinue}
            className="lead-cta w-full text-[16px]"
          >
            {submitting ? "Saving…" : "Continue to watch a video →"}
          </button>
          <div className="mt-2.5 text-center text-[12px] text-[var(--slate)]">
            {age === "under_18"
              ? "A parent/guardian must sign before you start"
              : "Takes about 15 minutes · You can stop anytime"}
          </div>
        </div>
        </div>
        </div>
      </div>

      {/* Phone-frame footer */}
      <div className="px-[26px] pb-7 pt-2.5 lg:hidden">
        <button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className="lead-cta w-full text-[16px]"
        >
          {submitting ? "Saving…" : "Continue to watch a video →"}
        </button>
        <div className="mt-2.5 text-center text-[11px] text-[var(--slate)]">
          {age === "under_18"
            ? "A parent/guardian must sign before you start"
            : "Takes about 15 minutes · You can stop anytime"}
        </div>
      </div>
    </PhoneFrame>
  );
}

function Row({
  icon,
  title,
  desc,
}: {
  icon: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[9px] text-[15px] text-[var(--teal)]"
        style={{ background: "#EAF6F4" }}
      >
        {icon}
      </div>
      <div>
        <b className="block text-[13.5px] font-bold leading-[1.25] text-[var(--ink)]">
          {title}
        </b>
        <span className="text-[12px] leading-[1.35] text-[var(--slate)]">
          {desc}
        </span>
      </div>
    </div>
  );
}

function Toggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-xl border-[1.5px] p-2.5 text-[13.5px] font-semibold transition-colors ${
        on
          ? "border-[var(--teal)] bg-[#E9F7F4] text-[var(--teal-deep)]"
          : "border-[var(--line)] bg-white text-[var(--slate)]"
      }`}
    >
      {children}
    </button>
  );
}
