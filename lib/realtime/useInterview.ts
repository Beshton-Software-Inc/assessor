"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeTokenResponse, UploadUrlResponse } from "@/lib/types";
import { buildRecordingStream, pickRecorderMimeType } from "./recorder";

export type InterviewPhase =
  | "idle"
  | "preparing"
  | "live"
  | "uploading"
  | "done"
  | "error";

interface InterviewState {
  phase: InterviewPhase;
  error: string | null;
  selfStream: MediaStream | null;
  aiSpeaking: boolean;
  startedAt: number | null;
}

const initialState: InterviewState = {
  phase: "idle",
  error: null,
  selfStream: null,
  aiSpeaking: false,
  startedAt: null,
};

const OPENAI_REALTIME_URL = "https://api.openai.com/v1/realtime/calls";

export function useInterview() {
  const [state, setState] = useState<InterviewState>(initialState);

  const sessionIdRef = useRef<string | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const userMediaRef = useRef<MediaStream | null>(null);
  const aiAudioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const cleanupRecordingRef = useRef<(() => void) | null>(null);
  const startedAtRef = useRef<number | null>(null);

  const teardown = useCallback(() => {
    try {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    } catch {}
    try {
      dataChannelRef.current?.close();
    } catch {}
    try {
      peerRef.current?.getSenders().forEach((s) => s.track?.stop());
      peerRef.current?.close();
    } catch {}
    try {
      userMediaRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    try {
      cleanupRecordingRef.current?.();
    } catch {}
    try {
      void audioCtxRef.current?.close();
    } catch {}
    if (aiAudioElRef.current) aiAudioElRef.current.srcObject = null;

    peerRef.current = null;
    dataChannelRef.current = null;
    userMediaRef.current = null;
    audioCtxRef.current = null;
    recorderRef.current = null;
    cleanupRecordingRef.current = null;
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const start = useCallback(
    async (
      aiAudioEl: HTMLAudioElement,
      opts?: { sessionId?: string },
    ) => {
      aiAudioElRef.current = aiAudioEl;
      setState({ ...initialState, phase: "preparing" });

      try {
        // Phase B: sessions are now pre-created by /assessor/start →
        // /api/sessions/start with a paired enduser. The legacy POST
        // /api/sessions path returns 400; if we get here without a
        // pre-created id the user came in by an unsupported route.
        if (opts?.sessionId) {
          sessionIdRef.current = opts.sessionId;
        } else {
          throw new Error(
            "No session id. Start an interview from the assessor pairing page.",
          );
        }

        const tokenRes = await fetch("/api/realtime/session", { method: "POST" });
        if (!tokenRes.ok) throw new Error("Could not authorize voice session");
        const token = (await tokenRes.json()) as RealtimeTokenResponse;

        const userMedia = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 1280 } },
        });
        userMediaRef.current = userMedia;

        const peer = new RTCPeerConnection();
        peerRef.current = peer;

        // Tee #1: send mic to AI. The user's video stays local — the AI does not see it.
        const micTrack = userMedia.getAudioTracks()[0];
        if (!micTrack) throw new Error("No microphone available");
        peer.addTrack(micTrack, userMedia);

        // Tee #2: receive AI audio. Played to the user via <audio> AND mixed into the recording.
        const aiStream = new MediaStream();
        peer.ontrack = (event) => {
          aiStream.addTrack(event.track);
          if (aiAudioElRef.current) aiAudioElRef.current.srcObject = aiStream;
        };

        // Data channel for control messages and transcript events.
        const dc = peer.createDataChannel("oai-events");
        dataChannelRef.current = dc;
        dc.addEventListener("message", (e) => {
          try {
            const msg = JSON.parse(e.data) as { type?: string };
            if (msg.type === "response.output_audio.delta") {
              setState((s) => (s.aiSpeaking ? s : { ...s, aiSpeaking: true }));
            } else if (
              msg.type === "response.output_audio.done" ||
              msg.type === "response.done"
            ) {
              setState((s) => ({ ...s, aiSpeaking: false }));
            }
          } catch {
            // non-JSON messages are ignored
          }
        });

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);

        const sdpRes = await fetch(OPENAI_REALTIME_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token.clientSecret}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        });
        if (!sdpRes.ok) {
          throw new Error(`OpenAI rejected SDP: ${sdpRes.status}`);
        }
        const answer: RTCSessionDescriptionInit = {
          type: "answer",
          sdp: await sdpRes.text(),
        };
        await peer.setRemoteDescription(answer);

        // Hand the user's self-view to the UI immediately for instant feedback.
        setState((s) => ({ ...s, selfStream: userMedia }));

        // Build the recording stream once we know AI audio is flowing.
        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;
        const { stream: recordStream, cleanup } = buildRecordingStream(
          audioCtx,
          userMedia,
          aiStream,
        );
        cleanupRecordingRef.current = cleanup;

        const mimeType = pickRecorderMimeType();
        const recorder = new MediaRecorder(
          recordStream,
          mimeType ? { mimeType } : undefined,
        );
        recorderRef.current = recorder;
        recordedChunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
        };
        recorder.start(1000);

        // Request that the AI begin per the system-prompt opening line.
        const sendOpening = () => {
          dc.send(
            JSON.stringify({
              type: "response.create",
              response: {
                modalities: ["audio", "text"],
                instructions:
                  "Begin by saying your opening line exactly as written in the system prompt, then pause and wait for the student's response.",
              },
            }),
          );
        };
        if (dc.readyState === "open") sendOpening();
        else dc.addEventListener("open", sendOpening, { once: true });

        startedAtRef.current = Date.now();
        setState((s) => ({ ...s, phase: "live", startedAt: startedAtRef.current }));
      } catch (err) {
        console.error(err);
        teardown();
        setState({
          ...initialState,
          phase: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
    [teardown],
  );

  const finish = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    setState((s) => ({ ...s, phase: "uploading" }));

    const recorder = recorderRef.current;
    const stoppedBlob = await new Promise<Blob | null>((resolve) => {
      if (!recorder || recorder.state === "inactive") {
        resolve(null);
        return;
      }
      recorder.onstop = () => {
        const type = recorder.mimeType || "video/webm";
        resolve(new Blob(recordedChunksRef.current, { type }));
      };
      recorder.stop();
    });

    // Tear down WebRTC immediately so the user's mic/camera light goes off,
    // but keep references long enough for the upload below.
    try {
      peerRef.current?.close();
      userMediaRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}

    const durationMs = startedAtRef.current ? Date.now() - startedAtRef.current : null;

    let recordingPath: string | null = null;
    try {
      if (stoppedBlob && stoppedBlob.size > 0) {
        const urlRes = await fetch(`/api/sessions/${sessionId}/upload-url`, {
          method: "POST",
        });
        if (!urlRes.ok) throw new Error("Could not get upload URL");
        const { uploadUrl, path } = (await urlRes.json()) as UploadUrlResponse;
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": stoppedBlob.type || "video/webm" },
          body: stoppedBlob,
        });
        if (!putRes.ok) throw new Error("Recording upload failed");
        recordingPath = path;
      }

      await fetch(`/api/sessions/${sessionId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordingPath, durationMs }),
      });
      setState((s) => ({ ...s, phase: "done" }));
    } catch (err) {
      console.error(err);
      await fetch(`/api/sessions/${sessionId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordingPath, durationMs, aborted: true }),
      }).catch(() => undefined);
      setState((s) => ({
        ...s,
        phase: "error",
        error: err instanceof Error ? err.message : "Upload failed",
      }));
    } finally {
      teardown();
    }
  }, [teardown]);

  return { state, start, finish };
}
