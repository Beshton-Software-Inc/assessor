"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UploadUrlResponse } from "@/lib/types";
import { pickRecorderMimeType } from "./recorder";

export type RecorderPhase =
  | "idle"
  | "preparing"
  | "recording"
  | "uploading"
  | "done"
  | "error";

interface RecorderState {
  phase: RecorderPhase;
  error: string | null;
  selfStream: MediaStream | null;
  startedAt: number | null;
  uploadProgress: number; // 0..100
}

const initial: RecorderState = {
  phase: "idle",
  error: null,
  selfStream: null,
  startedAt: null,
  uploadProgress: 0,
};

/**
 * One-way mic + camera recorder for page 4 of the LEAD flow. Unlike
 * useInterview() this never opens an RTCPeerConnection — there is no AI
 * voice and no audio mixing. The student records their presentation; the
 * blob is uploaded directly to Supabase Storage via the same signed-URL
 * route that the assessor flow uses.
 *
 * Lifecycle:
 *   start(sessionId)  → getUserMedia, start MediaRecorder
 *   stop()            → finalize blob, upload, mark session complete
 */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>(initial);

  const sessionIdRef = useRef<string | null>(null);
  const userMediaRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);

  const teardownStream = useCallback(() => {
    try {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    } catch {}
    try {
      userMediaRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    userMediaRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => () => teardownStream(), [teardownStream]);

  const start = useCallback(
    async (sessionId: string) => {
      sessionIdRef.current = sessionId;
      setState({ ...initial, phase: "preparing" });

      try {
        const userMedia = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: {
            facingMode: "user",
            width: { ideal: 720 },
            height: { ideal: 1280 },
          },
        });
        userMediaRef.current = userMedia;

        const mimeType = pickRecorderMimeType();
        const recorder = new MediaRecorder(
          userMedia,
          mimeType ? { mimeType } : undefined,
        );
        recorderRef.current = recorder;
        chunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.start(1000);

        startedAtRef.current = Date.now();
        setState({
          ...initial,
          phase: "recording",
          selfStream: userMedia,
          startedAt: startedAtRef.current,
        });
      } catch (err) {
        console.error(err);
        teardownStream();
        setState({
          ...initial,
          phase: "error",
          error: err instanceof Error ? err.message : "Could not start camera",
        });
      }
    },
    [teardownStream],
  );

  const stop = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    setState((s) => ({ ...s, phase: "uploading", uploadProgress: 0 }));

    const recorder = recorderRef.current;
    const blob = await new Promise<Blob | null>((resolve) => {
      if (!recorder || recorder.state === "inactive") {
        resolve(null);
        return;
      }
      recorder.onstop = () => {
        const type = recorder.mimeType || "video/webm";
        resolve(new Blob(chunksRef.current, { type }));
      };
      recorder.stop();
    });

    // Stop the camera/mic tracks immediately — the indicator light goes off
    // even if the upload takes a while.
    try {
      userMediaRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}

    const durationMs = startedAtRef.current ? Date.now() - startedAtRef.current : null;

    let recordingPath: string | null = null;
    try {
      if (blob && blob.size > 0) {
        const urlRes = await fetch(`/api/sessions/${sessionId}/upload-url`, {
          method: "POST",
        });
        if (!urlRes.ok) throw new Error("Could not get upload URL");
        const { uploadUrl, path } = (await urlRes.json()) as UploadUrlResponse;

        // We use XHR (not fetch) so we can stream upload progress to the UI
        // for the page-5 background banner.
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadUrl);
          xhr.setRequestHeader("Content-Type", blob.type || "video/webm");
          xhr.upload.onprogress = (ev) => {
            if (!ev.lengthComputable) return;
            const pct = Math.round((ev.loaded / ev.total) * 100);
            setState((s) => ({ ...s, uploadProgress: pct }));
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`Upload HTTP ${xhr.status}`));
          };
          xhr.onerror = () => reject(new Error("Upload network error"));
          xhr.send(blob);
        });
        recordingPath = path;
      }

      await fetch(`/api/sessions/${sessionId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordingPath, durationMs }),
      });
      setState((s) => ({ ...s, phase: "done", uploadProgress: 100 }));
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
    }
  }, []);

  return { state, start, stop };
}
