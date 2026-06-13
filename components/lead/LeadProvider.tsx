"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { LeadRunPublic } from "@/lib/types";
import { useRecorder } from "@/lib/realtime/useRecorder";

interface LeadContextValue {
  run: LeadRunPublic | null;
  refreshRun: () => Promise<void>;
  ensureRun: () => Promise<LeadRunPublic>;
  patchRun: (
    patch: Record<string, unknown>,
  ) => Promise<LeadRunPublic | null>;
  ensurePresentationSession: () => Promise<string>;
  ensureQaSession: () => Promise<string>;
  recorder: ReturnType<typeof useRecorder>;
}

const LeadContext = createContext<LeadContextValue | null>(null);

export function LeadProvider({ children }: { children: React.ReactNode }) {
  const [run, setRun] = useState<LeadRunPublic | null>(null);
  const recorder = useRecorder();
  // Avoid duplicate POSTs when StrictMode double-renders or navigation
  // re-mounts a child too fast.
  const ensureRunInflight = useRef<Promise<LeadRunPublic> | null>(null);

  const refreshRun = useCallback(async () => {
    const res = await fetch("/api/lead/runs", { method: "GET" });
    if (!res.ok) return;
    const data = (await res.json()) as { run: LeadRunPublic | null };
    setRun(data.run);
  }, []);

  const ensureRun = useCallback(async (): Promise<LeadRunPublic> => {
    if (run) return run;
    if (ensureRunInflight.current) return ensureRunInflight.current;
    const p = (async () => {
      const res = await fetch("/api/lead/runs", { method: "POST" });
      if (!res.ok) throw new Error("Could not start lead run");
      const data = (await res.json()) as { run: LeadRunPublic };
      setRun(data.run);
      return data.run;
    })();
    ensureRunInflight.current = p;
    try {
      return await p;
    } finally {
      ensureRunInflight.current = null;
    }
  }, [run]);

  const patchRun = useCallback(
    async (patch: Record<string, unknown>): Promise<LeadRunPublic | null> => {
      const r = await ensureRun();
      const res = await fetch(`/api/lead/runs/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { run: LeadRunPublic };
      setRun(data.run);
      return data.run;
    },
    [ensureRun],
  );

  const ensurePresentationSession = useCallback(async (): Promise<string> => {
    const r = await ensureRun();
    if (r.presentationSessionId) return r.presentationSessionId;
    const res = await fetch(`/api/lead/runs/${r.id}/presentation`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("Could not start presentation session");
    const data = (await res.json()) as { sessionId: string };
    setRun((prev) =>
      prev ? { ...prev, presentationSessionId: data.sessionId } : prev,
    );
    return data.sessionId;
  }, [ensureRun]);

  const ensureQaSession = useCallback(async (): Promise<string> => {
    const r = await ensureRun();
    if (r.qaSessionId) return r.qaSessionId;
    const res = await fetch(`/api/lead/runs/${r.id}/qa`, { method: "POST" });
    if (!res.ok) throw new Error("Could not start Q&A session");
    const data = (await res.json()) as { sessionId: string };
    setRun((prev) => (prev ? { ...prev, qaSessionId: data.sessionId } : prev));
    return data.sessionId;
  }, [ensureRun]);

  useEffect(() => {
    void refreshRun();
  }, [refreshRun]);

  const value = useMemo<LeadContextValue>(
    () => ({
      run,
      refreshRun,
      ensureRun,
      patchRun,
      ensurePresentationSession,
      ensureQaSession,
      recorder,
    }),
    [
      run,
      refreshRun,
      ensureRun,
      patchRun,
      ensurePresentationSession,
      ensureQaSession,
      recorder,
    ],
  );

  return <LeadContext.Provider value={value}>{children}</LeadContext.Provider>;
}

export function useLead(): LeadContextValue {
  const ctx = useContext(LeadContext);
  if (!ctx) throw new Error("useLead must be used inside <LeadProvider>");
  return ctx;
}
