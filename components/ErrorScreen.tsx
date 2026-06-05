"use client";

interface Props {
  message: string;
}

export function ErrorScreen({ message }: Props) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/20 text-rose-400">
        <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
          <path
            d="M12 8v5m0 3.5h.01M10.29 3.86l-8.18 14.14A2 2 0 003.83 21h16.34a2 2 0 001.72-3l-8.18-14.14a2 2 0 00-3.42 0z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="max-w-xs text-sm text-neutral-400">{message}</p>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-900"
      >
        Try again
      </button>
    </div>
  );
}
