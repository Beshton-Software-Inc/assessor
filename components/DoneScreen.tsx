export function DoneScreen() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
        <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
          <path
            d="M5 12l4 4L19 7"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Thanks for talking with Alex</h1>
        <p className="max-w-xs text-neutral-400">
          Your conversation has been saved. You can close this page.
        </p>
      </div>
    </div>
  );
}
