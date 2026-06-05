"use client";

interface Props {
  onBegin: () => void;
  preparing?: boolean;
}

export function StartGate({ onBegin, preparing }: Props) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Hi — meet Alex</h1>
        <p className="mx-auto max-w-xs text-base text-neutral-400">
          A two-minute voice chat with your AI academic counselor. Your camera
          and mic will turn on after you tap below.
        </p>
      </div>

      <button
        type="button"
        onClick={onBegin}
        disabled={preparing}
        className="relative flex h-20 w-20 items-center justify-center rounded-full bg-indigo-500 text-white shadow-lg shadow-indigo-500/40 transition active:scale-95 disabled:opacity-60"
        aria-label="Begin interview"
      >
        {!preparing && (
          <span className="pulse-ring absolute inset-0 rounded-full bg-indigo-500" />
        )}
        <span className="relative">
          {preparing ? (
            <Spinner />
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-8 w-8">
              <path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3z" />
              <path d="M19 11a1 1 0 10-2 0 5 5 0 01-10 0 1 1 0 10-2 0 7 7 0 006 6.92V20H8a1 1 0 100 2h8a1 1 0 100-2h-3v-2.08A7 7 0 0019 11z" />
            </svg>
          )}
        </span>
      </button>

      <p className="text-sm text-neutral-500">
        {preparing ? "Connecting…" : "Tap to begin"}
      </p>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-8 w-8 animate-spin text-white" viewBox="0 0 24 24">
      <circle
        className="opacity-30"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"
      />
    </svg>
  );
}
