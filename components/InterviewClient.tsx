"use client";

import { useEffect, useRef } from "react";
import { useInterview } from "@/lib/realtime/useInterview";
import { StartGate } from "./StartGate";
import { LiveInterview } from "./LiveInterview";
import { DoneScreen } from "./DoneScreen";
import { ErrorScreen } from "./ErrorScreen";

export function InterviewClient({ sessionId }: { sessionId?: string } = {}) {
  const { state, start, finish } = useInterview();
  const aiAudioRef = useRef<HTMLAudioElement>(null);

  // The <audio> element must exist before start() so we can pipe AI audio into it.
  useEffect(() => {
    if (aiAudioRef.current) aiAudioRef.current.autoplay = true;
  }, []);

  const handleBegin = async () => {
    if (!aiAudioRef.current) return;
    await start(aiAudioRef.current, sessionId ? { sessionId } : undefined);
  };

  return (
    <main className="relative flex min-h-dvh flex-col">
      {/* Hidden audio sink for the AI's voice. iOS will play through speakers when allowed. */}
      <audio ref={aiAudioRef} playsInline className="hidden" />

      {state.phase === "idle" && <StartGate onBegin={handleBegin} />}
      {state.phase === "preparing" && (
        <StartGate onBegin={handleBegin} preparing />
      )}
      {(state.phase === "live" || state.phase === "uploading") && (
        <LiveInterview
          selfStream={state.selfStream}
          aiSpeaking={state.aiSpeaking}
          uploading={state.phase === "uploading"}
          onDone={finish}
        />
      )}
      {state.phase === "done" && <DoneScreen />}
      {state.phase === "error" && (
        <ErrorScreen message={state.error ?? "Something went wrong."} />
      )}
    </main>
  );
}
