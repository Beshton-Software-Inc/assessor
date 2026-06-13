"use client";

import { useEffect, useRef, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { PhoneFrame } from "@/components/lead/PhoneFrame";
import { ProgressHeader } from "@/components/lead/ProgressHeader";
import { RecorderStage } from "@/components/lead/RecorderStage";
import { useLead } from "@/components/lead/LeadProvider";

export default function LeadRecordPage() {
  const router = useRouter();
  const { ensurePresentationSession, recorder } = useLead();
  const [elapsed, setElapsed] = useState(0);
  const startedRef = useRef(false);

  // Recording starts automatically — the user already opted in by tapping
  // "I'm ready to present" on /lead/watch. iOS still requires a user
  // gesture for getUserMedia, but that gesture happened on the previous
  // page within the same browsing context, which mobile Safari accepts.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const sessionId = await ensurePresentationSession();
        await recorder.start(sessionId);
      } catch (err) {
        console.error(err);
      }
    })();
    // We intentionally do NOT teardown the recorder on unmount — page 5
    // depends on the upload continuing while the user fills the form.
    // It's the recorder.stop() path that ends the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (recorder.state.phase !== "recording") return;
    const id = setInterval(() => setElapsed((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [recorder.state.phase]);

  async function onDone() {
    // Kick off the upload but navigate immediately — the upload runs in
    // the background banner on page 5 because LeadProvider lives in the
    // /lead layout and survives navigation.
    void recorder.stop();
    router.push("/lead/register" as Route);
  }

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return `${m}:${ss < 10 ? "0" : ""}${ss}`;
  };

  return (
    <PhoneFrame>
      <ProgressHeader
        step={3}
        back="/lead/watch"
        stage={{ num: 2, label: "Present" }}
        right={
          <span
            className="lead-display inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[15px] font-bold text-white shadow-[0_6px_16px_-6px_rgba(255,77,77,0.6)]"
            style={{ background: "var(--rec)" }}
          >
            <span className="lead-blink h-2 w-2 rounded-full bg-white" />
            {fmt(elapsed)}
          </span>
        }
      />

      <RecorderStage recorder={recorder} />

      <div className="flex-1 px-[22px] pt-4">
        <div className="lead-display mb-1 text-[16px] font-extrabold tracking-[-0.01em] text-[var(--ink)]">
          Keep these in mind
        </div>
        <div className="mb-3 text-[12px] font-semibold text-[var(--teal-deep)]">
          Where do you stand? · Weigh the 3 views · Give examples
        </div>

        <Tip
          n={1}
          title="Creativity over rules"
          desc="online reinvention is positive; embrace it."
        />
        <Tip
          n={2}
          title="Clarity matters"
          desc="shared standards keep communication clear."
        />
        <Tip
          n={3}
          title="Who does it serve?"
          desc="judge changes by who they include or leave behind."
        />
      </div>

      <div className="px-[22px] pb-7 pt-3.5">
        <button
          type="button"
          onClick={onDone}
          disabled={recorder.state.phase !== "recording"}
          className="lead-cta w-full text-[16px]"
        >
          {recorder.state.phase === "preparing" && "Getting camera ready…"}
          {recorder.state.phase === "recording" && (
            <>
              I&apos;m done with my presentation <span>→</span>
            </>
          )}
          {recorder.state.phase === "uploading" && "Uploading…"}
          {recorder.state.phase === "error" && "Camera error"}
        </button>
        {recorder.state.phase === "error" && (
          <div className="mt-2 text-center text-[11px] text-red-600">
            {recorder.state.error}
          </div>
        )}
        <div className="mt-2.5 text-center text-[11px] text-[var(--slate)]">
          Take your time · ≈ 3–5 minutes
        </div>
      </div>
    </PhoneFrame>
  );
}

function Tip({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="mb-2 flex items-start gap-3">
      <div
        className="lead-display flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg text-[12px] font-extrabold text-[var(--teal-deep)]"
        style={{ background: "#EAF6F4" }}
      >
        {n}
      </div>
      <div className="text-[12.5px] leading-[1.42] text-[var(--read)]">
        <b className="font-bold text-[var(--ink)]">{title}</b> — {desc}
      </div>
    </div>
  );
}
