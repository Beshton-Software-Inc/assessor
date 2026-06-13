"use client";

import { useEffect, useRef } from "react";
import type { useRecorder } from "@/lib/realtime/useRecorder";

interface Props {
  recorder: ReturnType<typeof useRecorder>;
}

export function RecorderStage({ recorder }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stream = recorder.state.selfStream;

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => undefined);
    }
  }, [stream]);

  return (
    <div className="relative mx-[22px] mt-4 h-[252px] overflow-hidden rounded-[22px]">
      <video
        ref={videoRef}
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 28%, #18514C 0%, #0E3A37 45%, #08231F 100%)",
        }}
      />
      {/* viewfinder grid */}
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
        style={{ boxShadow: "inset 0 0 90px 20px rgba(0,0,0,0.4)" }}
      />
      <div
        className="pointer-events-none absolute inset-0 rounded-[22px]"
        style={{ boxShadow: "inset 0 0 0 3px rgba(255,77,77,0.7)" }}
      />
      <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
        <span className="lead-blink h-[7px] w-[7px] rounded-full bg-[var(--rec)]" />
        REC
      </div>
      <div className="absolute bottom-3 right-3.5 text-[10.5px] font-semibold text-white/60">
        Front camera
      </div>
    </div>
  );
}
