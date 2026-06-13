"use client";

/**
 * Wraps each LEAD page in the iPhone-style frame from the mockups on
 * desktop, but expands to fill the screen on real phones. Same content
 * either way — the difference is purely visual chrome for desktop preview.
 */
export function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-8 sm:py-12">
      <div
        className="relative w-full max-w-[390px] sm:rounded-[46px] sm:bg-[#0B2B29] sm:p-3 sm:shadow-[0_40px_80px_-30px_rgba(11,43,41,0.55)]"
        style={{
          height: "100dvh",
          maxHeight: "780px",
        }}
      >
        <div className="relative flex h-full w-full flex-col overflow-hidden bg-[var(--bg)] sm:rounded-[36px]">
          {/* iOS-style notch — desktop only */}
          <div className="absolute left-1/2 top-0 z-30 hidden h-[26px] w-[120px] -translate-x-1/2 rounded-b-2xl bg-[#0B2B29] sm:block" />
          {children}
        </div>
      </div>
    </main>
  );
}
