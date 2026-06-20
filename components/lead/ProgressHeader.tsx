"use client";

import Link from "next/link";
import type { Route } from "next";

interface Props {
  step: 1 | 2 | 3 | 4;
  back?: string;
  // Right-aligned slot — used by record/QA pages for a timer or stage chip.
  right?: React.ReactNode;
  stage?: { num: number; label: string };
}

const FILL_PCT = { 1: "25%", 2: "50%", 3: "75%", 4: "100%" } as const;

export function ProgressHeader({ step, back, right, stage }: Props) {
  return (
    <div className="relative z-10 px-[22px] pt-10 lg:px-10 lg:pt-8">
      <div className="flex items-center gap-2.5 lg:gap-4">
        {back ? (
          <Link
            href={back as Route}
            className="text-xl leading-none text-[var(--slate)] no-underline"
            aria-label="Back"
          >
            ‹
          </Link>
        ) : (
          <span className="w-3" />
        )}
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#DCEEEB]">
          <div
            className="h-full rounded-full"
            style={{
              width: FILL_PCT[step],
              background: "linear-gradient(90deg,var(--teal-bright),var(--teal))",
            }}
          />
        </div>
        <div className="text-[11.5px] font-semibold text-[var(--slate)]">
          Step {step} of 4
        </div>
      </div>
      {(stage || right) && (
        <div className="mt-3.5 flex items-center justify-between">
          {stage ? (
            <div className="inline-flex items-center gap-2 text-[13px] font-bold text-[var(--teal-deep)]">
              <span
                className="lead-display flex h-[22px] w-[22px] items-center justify-center rounded-md text-[12px] font-extrabold text-[#04201C]"
                style={{ background: "var(--teal-bright)" }}
              >
                {stage.num}
              </span>
              {stage.label}
            </div>
          ) : (
            <span />
          )}
          {right}
        </div>
      )}
    </div>
  );
}
