"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { PhoneFrame } from "@/components/lead/PhoneFrame";
import { ProgressHeader } from "@/components/lead/ProgressHeader";

const VIDEO_DURATION_S = 48;

export default function LeadWatchPage() {
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!playing) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    tickRef.current = setInterval(() => {
      setPos((p) => {
        const next = p + 0.25;
        if (next >= VIDEO_DURATION_S) {
          setPlaying(false);
          return VIDEO_DURATION_S;
        }
        return next;
      });
    }, 60);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [playing]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${m}:${ss < 10 ? "0" : ""}${ss}`;
  };

  return (
    <PhoneFrame>
      <ProgressHeader
        step={2}
        back="/lead/consent"
        stage={{ num: 1, label: "Watch" }}
        right={
          <span className="rounded-full bg-[#EAF6F4] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--slate)]">
            ▶ 0:48
          </span>
        }
      />

      <div
        className="flex-1 overflow-y-auto px-[22px] pb-32 pt-3.5 lg:overflow-visible lg:px-10 lg:pb-12 lg:pt-8"
        style={{ scrollbarWidth: "none" }}
      >
        <div className="lg:grid lg:grid-cols-[1.3fr_1fr] lg:gap-12">
        {/* Video player (simulated, matches mockup) */}
        <div
          className={`relative mb-4 h-[208px] overflow-hidden rounded-[18px] shadow-[0_18px_38px_-20px_rgba(13,148,136,0.7)] lg:mb-0 lg:h-[420px] ${
            playing ? "is-playing" : ""
          }`}
          style={{
            background:
              "radial-gradient(120% 120% at 80% 0%, #15B5A6 0%, #0E7F75 55%, #0B5F58 100%)",
          }}
        >
          <div
            className="absolute inset-0 p-4 transition-opacity"
            style={{ opacity: playing ? 0.4 : 1 }}
          >
            <div className="lead-display text-[50px] font-extrabold leading-none tracking-[-0.02em] text-white/95">
              POV
            </div>
            <div className="mt-2.5">
              <span className="inline-block rounded-[13px] bg-white/20 px-2.5 py-1.5 text-xs font-semibold text-white/85 line-through">
                &ldquo;point of view&rdquo;
              </span>
              <span className="ml-2 inline-block rounded-[13px] bg-white px-2.5 py-1.5 text-xs font-semibold text-[var(--teal-deep)]">
                &ldquo;imagine this is you&rdquo; 👀
              </span>
            </div>
          </div>

          {!playing && (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              className="absolute left-1/2 top-[46%] flex h-[60px] w-[60px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-white shadow-[0_12px_26px_-8px_rgba(244,80,43,0.7)] transition-transform hover:scale-105"
              style={{ background: "var(--coral)" }}
              aria-label="Play"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="#fff"
                style={{ marginLeft: 3 }}
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          )}

          <div
            className="absolute inset-x-0 bottom-0 flex items-center gap-2.5 p-3"
            style={{
              background: "linear-gradient(to top,rgba(4,20,18,0.7),transparent)",
            }}
          >
            <button
              type="button"
              onClick={() => setPlaying((v) => !v)}
              aria-label={playing ? "Pause" : "Play"}
              className="text-white"
            >
              {playing ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(pos / VIDEO_DURATION_S) * 100}%`,
                  background: "var(--coral)",
                }}
              />
            </div>
            <span className="font-mono text-[11px] font-semibold text-white">
              {fmt(pos)} / 0:48
            </span>
          </div>
        </div>

        <div>
        <h2 className="lead-display mb-3.5 text-[21px] font-extrabold leading-[1.18] tracking-[-0.01em] lg:text-[28px]">
          Is changing words online clever — or just wrong?
        </h2>

        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--teal-deep)]">
          While you watch, consider
        </div>
        <Persp n={1} title="Creativity" desc="reinvention is good; embrace it." />
        <Persp n={2} title="Clarity" desc="shared meaning matters; resist the blur." />
        <Persp
          n={3}
          title="Who it serves"
          desc="does it include people, or leave them out?"
        />

        <div
          className="mt-3 rounded-[13px] p-3 text-[12.5px] font-semibold leading-[1.45] text-[var(--teal-deep)] lg:text-[14px]"
          style={{ background: "#EAF6F4" }}
        >
          <b className="text-[var(--ink)]">In your talk:</b> where do you stand?
          Weigh all three, and back it up with an example.
        </div>

        {/* Desktop CTA */}
        <div className="mt-6 hidden lg:block">
          <Link
            href={"/lead/record" as Route}
            className="lead-cta w-full text-[16px]"
          >
            I&apos;m ready to present <span>→</span>
          </Link>
          <div className="mt-2 text-center text-[12px] text-[var(--slate)]">
            Take a moment to gather your thoughts
          </div>
        </div>
        </div>
        </div>
      </div>

      {/* Phone-frame floating CTA */}
      <div
        className="absolute inset-x-0 bottom-0 z-20 px-[22px] pb-7 pt-3.5 lg:hidden"
        style={{
          background: "linear-gradient(to top,var(--bg) 62%,transparent)",
        }}
      >
        <Link
          href={"/lead/record" as Route}
          className="lead-cta w-full text-[16px]"
        >
          I&apos;m ready to present <span>→</span>
        </Link>
        <div className="mt-2 text-center text-[11px] text-[var(--slate)]">
          Take a moment to gather your thoughts
        </div>
      </div>
    </PhoneFrame>
  );
}

function Persp({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="mb-2 flex items-center gap-3 rounded-[13px] border border-[var(--line)] bg-[var(--card)] px-3 py-2.5 shadow-[0_8px_18px_-16px_rgba(13,148,136,0.4)]">
      <div
        className="lead-display flex h-6 w-6 flex-none items-center justify-center rounded-md text-[11px] font-extrabold text-[var(--teal-deep)]"
        style={{ background: "#EAF6F4" }}
      >
        {n}
      </div>
      <div className="text-[12.5px] leading-[1.35] text-[var(--read)]">
        <b className="font-bold text-[var(--ink)]">{title}</b> — {desc}
      </div>
    </div>
  );
}
