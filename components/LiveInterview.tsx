"use client";

import { useEffect, useRef } from "react";

interface Props {
  selfStream: MediaStream | null;
  aiSpeaking: boolean;
  uploading: boolean;
  onDone: () => void;
}

export function LiveInterview({ selfStream, aiSpeaking, uploading, onDone }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && selfStream) {
      videoRef.current.srcObject = selfStream;
    }
  }, [selfStream]);

  return (
    <div className="relative flex flex-1 flex-col">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
      />

      {/* Top gradient + AI status pill */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="relative z-10 flex items-center justify-center pt-[max(env(safe-area-inset-top),1rem)]">
        <div className="flex items-center gap-2 rounded-full bg-black/50 px-4 py-2 text-sm backdrop-blur">
          <span
            className={`h-2 w-2 rounded-full ${
              aiSpeaking ? "bg-indigo-400" : "bg-neutral-500"
            }`}
          />
          <span className="text-neutral-100">
            {aiSpeaking ? "Alex is speaking" : "Alex is listening"}
          </span>
        </div>
      </div>

      {/* Bottom gradient + done button */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/80 to-transparent" />
      <div className="relative z-10 mt-auto flex flex-col items-center gap-3 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
        <button
          type="button"
          onClick={onDone}
          disabled={uploading}
          className="rounded-full bg-white px-8 py-4 text-base font-semibold text-neutral-900 shadow-lg transition active:scale-95 disabled:opacity-70"
        >
          {uploading ? "Saving…" : "I'm Done"}
        </button>
        <p className="text-xs text-neutral-300">
          {uploading
            ? "Uploading your recording — please wait."
            : "Tap when Alex says you're finished."}
        </p>
      </div>
    </div>
  );
}
