"use client";

import { useEffect, useRef } from "react";
import type { useInterview } from "@/lib/realtime/useInterview";

interface Props {
  interview: ReturnType<typeof useInterview>;
}

export function QaStage({ interview }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stream = interview.state.selfStream;

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => undefined);
    }
  }, [stream]);

  const aiSpeaking = interview.state.aiSpeaking;
  const liveOrUploading =
    interview.state.phase === "live" || interview.state.phase === "uploading";

  return (
    <div className="relative h-[416px] w-[300px] max-w-[88%] overflow-hidden rounded-[26px] shadow-[0_28px_54px_-22px_rgba(11,43,41,0.6)] lg:h-[520px] lg:w-[640px] lg:max-w-full">
      <video
        ref={videoRef}
        muted
        playsInline
        className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 26%,#18514C,#0E3A37 55%,#08231F)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.045) 1px,transparent 1px)",
          backgroundSize: "33.33% 33.33%",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: "inset 0 0 100px 24px rgba(0,0,0,0.42)" }}
      />
      {liveOrUploading && (
        <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
          <span className="lead-blink h-[7px] w-[7px] rounded-full bg-[#FF4D4D]" />
          REC
        </div>
      )}
      <div className="absolute bottom-3 left-3.5 rounded-full bg-black/30 px-2.5 py-1 text-[11px] font-semibold text-white/80">
        You
      </div>
      {/* corner badge that mirrors AI vs you turn */}
      <div className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
        {aiSpeaking ? "Alex speaking" : "Your turn"}
      </div>
    </div>
  );
}
