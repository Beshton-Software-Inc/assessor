"use client";

import Link from "next/link";

/**
 * Responsive shell for /lead/*.
 *
 *   < lg (1024px): iPhone-style frame from the original mockups —
 *     fixed 390px wide, 100dvh tall (capped 780px on tablets), notch,
 *     dark bezel.
 *   >= lg: drops every piece of phone chrome — full-width page with a
 *     LEAD top bar and a centered max-w-5xl content column. Children
 *     are rendered once; the visual switch is pure CSS so component
 *     state, refs, and media handles are preserved across breakpoints.
 */
export function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="
        flex min-h-dvh flex-col items-center justify-center px-4 py-8
        sm:py-12
        lg:min-h-dvh lg:items-stretch lg:justify-start lg:px-0 lg:py-0
      "
    >
      {/* Desktop-only top bar */}
      <header className="hidden w-full border-b border-[var(--line)] bg-white/80 backdrop-blur lg:block">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-10 py-4">
          <Link href="/lead" className="flex items-center gap-2.5 no-underline">
            <span
              className="lead-display flex h-8 w-8 items-center justify-center rounded-[10px] text-[18px] font-extrabold text-white shadow-[0_6px_14px_-4px_rgba(13,148,136,0.6)]"
              style={{
                background:
                  "linear-gradient(140deg,var(--teal-bright),var(--teal-deep))",
              }}
            >
              L
            </span>
            <span className="lead-display text-[19px] font-bold tracking-tight text-[var(--ink)]">
              LEAD
            </span>
          </Link>
          <div
            className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-[var(--teal-deep)]"
            style={{ background: "#D7F2EE" }}
          >
            ≈ 15 min · college-readiness check
          </div>
        </div>
      </header>

      <div
        className="
          relative w-full max-w-[390px] h-[100dvh] max-h-[780px]
          sm:rounded-[46px] sm:bg-[#0B2B29] sm:p-3 sm:shadow-[0_40px_80px_-30px_rgba(11,43,41,0.55)]
          lg:max-w-none lg:h-auto lg:max-h-none lg:flex-1 lg:rounded-none lg:bg-transparent lg:p-0 lg:shadow-none
        "
      >
        <div
          className="
            relative flex h-full w-full flex-col overflow-hidden bg-[var(--bg)]
            sm:rounded-[36px]
            lg:mx-auto lg:max-w-6xl lg:rounded-none lg:overflow-visible
          "
        >
          {/* iOS-style notch — phone-frame breakpoints only */}
          <div className="absolute left-1/2 top-0 z-30 hidden h-[26px] w-[120px] -translate-x-1/2 rounded-b-2xl bg-[#0B2B29] sm:block lg:hidden" />
          {children}
        </div>
      </div>
    </main>
  );
}
