"use client";

import { useEffect, useRef, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { PhoneFrame } from "@/components/lead/PhoneFrame";
import { ProgressHeader } from "@/components/lead/ProgressHeader";
import { QaStage } from "@/components/lead/QaStage";
import { useInterview } from "@/lib/realtime/useInterview";
import { useLead } from "@/components/lead/LeadProvider";

export default function LeadQaPage() {
  const router = useRouter();
  const { ensureQaSession } = useLead();
  const interview = useInterview();
  const aiAudioRef = useRef<HTMLAudioElement | null>(null);
  const startedRef = useRef(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (aiAudioRef.current) aiAudioRef.current.autoplay = true;
  }, []);

  // Auto-start the Q&A on mount. The user has already given a media gesture
  // by tapping through the previous pages.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const sessionId = await ensureQaSession();
        if (!aiAudioRef.current) return;
        await interview.start(aiAudioRef.current, {
          sessionId,
          persona: "qa",
        });
      } catch (err) {
        console.error(err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once finished + uploaded, advance to the "What's next" page.
  useEffect(() => {
    if (interview.state.phase === "done") {
      router.replace("/lead/done" as Route);
    }
  }, [interview.state.phase, router]);

  const aiSpeaking = interview.state.aiSpeaking;
  const phase = interview.state.phase;
  const isLive = phase === "live";

  return (
    <PhoneFrame>
      <audio ref={aiAudioRef} playsInline className="hidden" />
      <ProgressHeader
        step={4}
        back="/lead/register"
        stage={{ num: 3, label: "Q&A" }}
      />

      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 pt-2">
        <QaStage interview={interview} />

        {/* small voice indicator */}
        <div className="flex items-center gap-3">
          <div
            className={`flex h-[52px] w-[52px] flex-none items-center justify-center rounded-full transition-colors ${
              aiSpeaking ? "" : ""
            }`}
            style={{
              background: aiSpeaking
                ? "radial-gradient(circle at 35% 30%,#3FD6C7,#0D9488 60%,#0B6F66)"
                : "radial-gradient(circle at 35% 30%,#FF9A82,#FF6B4A 60%,#E2451F)",
              boxShadow: aiSpeaking
                ? "0 10px 22px -8px rgba(13,148,136,0.6)"
                : "0 10px 22px -8px rgba(244,80,43,0.55)",
            }}
          >
            {aiSpeaking ? (
              <div className="flex h-[22px] items-center gap-[3px]">
                {[0, 0.15, 0.3, 0.45, 0.1].map((d, i) => (
                  <span
                    key={i}
                    className="lead-eq-bar w-[3.5px] rounded-full bg-white/95"
                    style={{ animationDelay: `${d}s`, height: 7 }}
                  />
                ))}
              </div>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v3" />
              </svg>
            )}
          </div>
          <div>
            <div
              className="text-[12px] font-bold uppercase tracking-wider"
              style={{ color: aiSpeaking ? "var(--teal-deep)" : "var(--coral-dark)" }}
            >
              {aiSpeaking ? "Interviewer speaking" : "Your turn — listening"}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[var(--slate)]">
              {aiSpeaking ? (
                "Answer naturally — no wrong answers."
              ) : (
                <>
                  Hearing you
                  <span className="inline-flex gap-[3px]">
                    {[0, 0.2, 0.4].map((d, i) => (
                      <span
                        key={i}
                        className="lead-yd-dot inline-block h-1 w-1 rounded-full"
                        style={{
                          background: "var(--coral)",
                          animationDelay: `${d}s`,
                        }}
                      />
                    ))}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-3.5 px-[22px] pb-7">
        <button
          type="button"
          aria-label="Captions"
          className="flex h-[52px] w-[52px] items-center justify-center rounded-full border-[1.5px] border-[var(--line)] bg-white text-[var(--slate)] transition-colors hover:border-[#C9DEDB]"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="5" width="18" height="14" rx="3" />
            <path d="M7 11.5a2 2 0 1 0 0 1M14 11.5a2 2 0 1 0 0 1" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => interview.finish()}
          disabled={!isLive}
          className="lead-cta max-w-[210px] flex-1 text-[15px]"
        >
          {phase === "preparing" && "Connecting…"}
          {phase === "live" && "End interview"}
          {phase === "uploading" && "Saving…"}
          {phase === "error" && "Try again"}
          {phase === "idle" && "Start"}
          {phase === "done" && "Done"}
        </button>
        <button
          type="button"
          aria-label={muted ? "Unmute" : "Mute mic"}
          aria-pressed={muted}
          onClick={() => {
            const stream = interview.state.selfStream;
            if (!stream) return;
            const newMuted = !muted;
            stream.getAudioTracks().forEach((t) => (t.enabled = !newMuted));
            setMuted(newMuted);
          }}
          className={`flex h-[52px] w-[52px] items-center justify-center rounded-full border-[1.5px] bg-white transition-colors ${
            muted ? "border-[var(--coral)] text-[var(--coral-dark)]" : "border-[var(--line)] text-[var(--slate)] hover:border-[#C9DEDB]"
          }`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v3" />
          </svg>
        </button>
      </div>

      {phase === "error" && (
        <div className="absolute inset-x-0 bottom-24 mx-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-center text-xs text-red-700">
          {interview.state.error}
        </div>
      )}
    </PhoneFrame>
  );
}
