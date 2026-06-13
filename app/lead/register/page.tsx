"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { PhoneFrame } from "@/components/lead/PhoneFrame";
import { useLead } from "@/components/lead/LeadProvider";
import { supabaseBrowser } from "@/lib/supabase/client";

const NEXT_PATH = "/lead/qa";
const GRADES = ["9th", "10th", "11th", "12th"] as const;

export default function LeadRegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterInner />
    </Suspense>
  );
}

function RegisterInner() {
  const router = useRouter();
  const { run, ensureRun, patchRun, recorder } = useLead();
  const [firstName, setFirstName] = useState("");
  const [grade, setGrade] = useState<string>("11th");
  const [shareWithAdvisers, setShareWithAdvisers] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [magicSent, setMagicSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from existing run state when a user comes back to this page.
  useEffect(() => {
    if (run?.firstName) setFirstName(run.firstName);
    if (run?.grade) setGrade(run.grade);
    if (typeof run?.shareWithAdvisers === "boolean") {
      setShareWithAdvisers(run.shareWithAdvisers);
    }
  }, [run?.firstName, run?.grade, run?.shareWithAdvisers]);

  // If the user lands here already signed in (e.g. came back from OAuth
  // callback), claim the lead run and proceed.
  useEffect(() => {
    void (async () => {
      const supa = supabaseBrowser();
      const { data } = await supa.auth.getUser();
      if (!data.user) return;
      const r = await ensureRun();
      const res = await fetch(`/api/lead/runs/${r.id}/claim`, {
        method: "POST",
      });
      if (res.ok) router.replace(NEXT_PATH as Route);
    })();
  }, [ensureRun, router]);

  async function persistProfile() {
    if (!firstName.trim()) {
      setError("Please enter your first name first.");
      return false;
    }
    setError(null);
    await patchRun({
      firstName: firstName.trim(),
      grade,
      shareWithAdvisers,
    });
    return true;
  }

  async function signInOAuth(provider: "google" | "apple") {
    if (!(await persistProfile())) return;
    const supa = supabaseBrowser();
    const callback = new URL(
      "/auth/callback",
      window.location.origin,
    );
    callback.searchParams.set("next", NEXT_PATH);
    const { error: e } = await supa.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callback.toString() },
    });
    if (e) setError(e.message);
  }

  async function signInMagic(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!(await persistProfile())) return;
    const supa = supabaseBrowser();
    const callback = new URL(
      "/auth/callback",
      window.location.origin,
    );
    callback.searchParams.set("next", NEXT_PATH);
    const { error: err } = await supa.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callback.toString() },
    });
    if (err) {
      setError(err.message);
      return;
    }
    setMagicSent(true);
  }

  const recPhase = recorder.state.phase;
  const uploadDone = recPhase === "done";
  const uploadError = recPhase === "error";
  const uploadPct = recorder.state.uploadProgress;

  return (
    <PhoneFrame>
      <div className="px-[22px] pt-10">
        <div
          className={`flex items-center gap-3 rounded-[15px] border border-[var(--line)] bg-[var(--card)] p-3 shadow-[0_8px_22px_-16px_rgba(13,148,136,0.5)]`}
        >
          {uploadDone ? (
            <div
              className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full text-base font-extrabold text-white"
              style={{ background: "var(--teal)" }}
            >
              ✓
            </div>
          ) : (
            <div
              className="lead-spin h-[30px] w-[30px] flex-none rounded-full border-[3px] border-[#DCEEEB]"
              style={{ borderTopColor: "var(--teal)" }}
            />
          )}
          <div className="flex-1">
            <b className="block text-[13px] font-bold text-[var(--ink)]">
              {uploadDone
                ? "Presentation uploaded"
                : uploadError
                  ? "Upload trouble — we'll retry"
                  : "Uploading your presentation…"}
            </b>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#E7F1EF]">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{
                  width: `${uploadPct}%`,
                  background:
                    "linear-gradient(90deg,var(--teal-bright),var(--teal))",
                }}
              />
            </div>
            <small className="text-[11px] text-[var(--slate)]">
              {uploadDone
                ? "Saved — finish signing up below."
                : "Keep this open — it runs in the background."}
            </small>
          </div>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto px-[22px] pb-2 pt-4"
        style={{ scrollbarWidth: "none" }}
      >
        <h1 className="lead-display mb-1 text-[26px] font-extrabold leading-[1.08] tracking-[-0.02em]">
          Get your results
        </h1>
        <p className="mb-4 text-[13.5px] font-medium leading-[1.45] text-[var(--slate)]">
          Create a free account so your report is waiting for you — and you can
          pick up where you left off.
        </p>

        <div className="mb-2 flex gap-2.5">
          <Field label="First name">
            <input
              type="text"
              placeholder="Anna"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full rounded-xl border-[1.5px] border-[var(--line)] bg-white px-3 py-3 text-[14px] text-[var(--ink)] outline-none focus:border-[var(--teal-bright)]"
            />
          </Field>
          <Field label="Grade">
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="w-full rounded-xl border-[1.5px] border-[var(--line)] bg-white px-3 py-3 text-[14px] text-[var(--ink)] outline-none focus:border-[var(--teal-bright)]"
            >
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mb-4 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => signInOAuth("google")}
            className="flex w-full items-center justify-center gap-2 rounded-[13px] border-[1.5px] border-[var(--line)] bg-white p-3.5 text-[14px] font-bold text-[var(--ink)] transition-transform hover:-translate-y-px"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white">
              <svg width="16" height="16" viewBox="0 0 48 48">
                <path
                  fill="#FFC107"
                  d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22 22-9.8 22-22c0-1.5-.2-2.6-.4-3.5z"
                />
                <path
                  fill="#FF3D00"
                  d="M4.3 14.7l6.6 4.8C12.7 16 17.9 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 4.1 29.6 2 24 2 15.5 2 8.1 6.8 4.3 14.7z"
                />
                <path
                  fill="#4CAF50"
                  d="M24 46c5.5 0 10.4-2.1 14.1-5.5l-6.5-5.5c-2 1.5-4.7 2.5-7.6 2.5-5.2 0-9.6-3.3-11.2-8l-6.5 5C7.9 41.1 15.3 46 24 46z"
                />
                <path
                  fill="#1976D2"
                  d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.5 5.5C40.9 36.3 46 31 46 24c0-1.5-.2-2.6-.4-3.5z"
                />
              </svg>
            </span>
            Sign in with Google
          </button>
          <button
            type="button"
            onClick={() => signInOAuth("apple")}
            className="flex w-full items-center justify-center gap-2 rounded-[13px] bg-[#0B2B29] p-3.5 text-[14px] font-bold text-white transition-transform hover:-translate-y-px"
          >
            <svg width="15" height="17" viewBox="0 0 384 512" fill="#fff">
              <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
            </svg>
            Sign in with Apple
          </button>
          <button
            type="button"
            onClick={() => setEmailOpen((v) => !v)}
            className="lead-cta w-full text-[14px]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M3 7l9 6 9-6" />
            </svg>
            Use Email to sign in
          </button>
        </div>

        {emailOpen && (
          <form onSubmit={signInMagic} className="mb-4 flex flex-col gap-2">
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border-[1.5px] border-[var(--line)] bg-white px-3 py-3 text-[14px] outline-none focus:border-[var(--teal-bright)]"
            />
            <button type="submit" className="lead-cta w-full text-[15px]">
              {magicSent ? "Check your inbox" : "Send magic link"}
            </button>
            {magicSent && (
              <p className="text-[12px] text-[var(--slate)]">
                We emailed a sign-in link to{" "}
                <strong className="text-[var(--ink)]">{email}</strong>.
              </p>
            )}
          </form>
        )}

        <button
          type="button"
          onClick={() => setShareWithAdvisers((v) => !v)}
          className="flex w-full items-start gap-2.5 rounded-[13px] p-3 text-left"
          style={{ background: "#EAF6F4" }}
        >
          <span
            className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-md border-2 text-xs font-extrabold transition-colors ${
              shareWithAdvisers
                ? "border-[var(--teal)] bg-[var(--teal)] text-white"
                : "border-[#B7D8D3] bg-white text-transparent"
            }`}
          >
            ✓
          </span>
          <span className="text-[12px] leading-[1.4] text-[var(--slate)]">
            <b className="text-[var(--ink)]">
              Share my results with vetted college advisers
            </b>{" "}
            for free guidance. Optional — change anytime.
          </span>
        </button>

        {error && (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
      </div>

      <div
        className="px-[22px] pb-7 pt-3"
        style={{
          background: "linear-gradient(to top,var(--bg) 70%,transparent)",
        }}
      >
        <div className="text-center text-[11px] text-[var(--slate)]">
          Email sign-in uses a magic link — no password. By continuing you agree
          to the Terms &amp; Privacy Policy.
        </div>
      </div>
    </PhoneFrame>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1.5">
      <span className="text-xs font-semibold text-[var(--slate)]">{label}</span>
      {children}
    </label>
  );
}
