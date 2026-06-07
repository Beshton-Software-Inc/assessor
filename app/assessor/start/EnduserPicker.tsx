"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { OrgEnduser } from "@/lib/pairing/endusers";

interface EnduserPickerProps {
  initialEndusers: OrgEnduser[];
}

/**
 * Searchable enduser list. The server hydrates `initialEndusers`; once the
 * user types we re-query GET /api/pairing/endusers?q=... so the substring
 * filter runs on the server (which is the canonical source of truth and
 * also hits any newly-invited students that were created in the parallel
 * Invite panel via router.refresh()).
 *
 * Click → POST /api/sessions/start with { enduserUserId } → push
 * '/?sessionId=...'. The interview UI mounted on `/` reads ?sessionId and
 * uses it instead of minting a new session.
 */
export function EnduserPicker({ initialEndusers }: EnduserPickerProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [endusers, setEndusers] = useState<OrgEnduser[]>(initialEndusers);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastReqId = useRef(0);

  // Re-sync when the server prop changes (e.g. after invite + router.refresh()).
  useEffect(() => {
    setEndusers(initialEndusers);
  }, [initialEndusers]);

  // Debounced server-side search on query change.
  useEffect(() => {
    const trimmed = query.trim();
    // Empty query: immediately show the server's initial list.
    if (!trimmed) {
      setEndusers(initialEndusers);
      setLoading(false);
      return;
    }
    const id = ++lastReqId.current;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/pairing/endusers?q=${encodeURIComponent(trimmed)}`,
          { cache: "no-store" },
        );
        if (id !== lastReqId.current) return; // a newer query superseded us
        if (!res.ok) {
          setError(`Search failed (${res.status})`);
          return;
        }
        const body = (await res.json()) as { endusers: OrgEnduser[] };
        setEndusers(body.endusers ?? []);
        setError(null);
      } catch (err) {
        if (id !== lastReqId.current) return;
        setError((err as Error).message);
      } finally {
        if (id === lastReqId.current) setLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query, initialEndusers]);

  const empty = !loading && endusers.length === 0;

  const summary = useMemo(() => {
    if (loading) return "Searching…";
    if (empty) return query.trim() ? "No matches" : "No students yet";
    return `${endusers.length} student${endusers.length === 1 ? "" : "s"}`;
  }, [loading, empty, endusers.length, query]);

  async function startWith(enduserUserId: string) {
    setError(null);
    setStarting(enduserUserId);
    try {
      const res = await fetch("/api/sessions/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enduserUserId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        setError(body.error ?? `Failed to start (${res.status})`);
        return;
      }
      const { sessionId } = (await res.json()) as { sessionId: string };
      router.push(`/?sessionId=${encodeURIComponent(sessionId)}` as Route);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(null);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="border-b border-neutral-100 px-5 py-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email…"
          autoComplete="off"
          spellCheck={false}
          className="block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        />
        <p className="mt-2 text-xs text-neutral-500">{summary}</p>
      </div>

      {error && (
        <p className="mx-5 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {empty ? (
        <div className="px-5 py-10 text-center text-sm text-neutral-500">
          {query.trim()
            ? "No students match that search. Use the invite panel to add one."
            : "No students in your organization yet. Use the invite panel to add the first one."}
        </div>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {endusers.map((e) => {
            const isStarting = starting === e.userId;
            const disabled = starting !== null;
            return (
              <li key={e.userId}>
                <button
                  type="button"
                  onClick={() => startWith(e.userId)}
                  disabled={disabled}
                  className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-neutral-50 disabled:opacity-60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-900">
                      {e.displayName ?? e.email ?? "Unnamed student"}
                    </p>
                    {e.email && (
                      <p className="truncate text-xs text-neutral-500">{e.email}</p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white">
                    {isStarting ? "Starting…" : "Start interview"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
