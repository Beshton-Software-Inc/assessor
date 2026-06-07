import { redirect } from "next/navigation";
import type { Route } from "next";
import { getUser } from "@/lib/auth/getUser";
import { InterviewClient } from "@/components/InterviewClient";

// Next.js 15 typed routes treats redirect() as taking Route<string>; the
// landing-page paths we resolve are dynamic, so cast at the boundary.
const route = (p: string): Route => p as Route;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Root entry point.
 *
 * Auth/role logic: signed-out users go to /login; app_admin and org_admin go
 * to their consoles; endusers go to /student.
 *
 * Assessor flow:
 * - With ?sessionId=… → mount the live interview UI here. The session has
 *   already been paired with an enduser via /assessor/start → POST
 *   /api/sessions/start, so InterviewClient just consumes the existing id.
 * - Without ?sessionId= → bounce to /assessor/start so the assessor picks or
 *   invites a student before the call begins. This enforces the phase-B
 *   pairing flow and prevents a null enduser_id.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getUser();
  if (!user) redirect(route("/login"));

  if (user.profile?.is_app_admin) redirect(route("/admin/org"));

  const memberships = user.memberships;
  if (memberships.some((m) => m.role === "org_admin")) redirect(route("/admin/org"));

  if (memberships.some((m) => m.role === "assessor")) {
    const params = await searchParams;
    const raw = params.sessionId;
    const sessionId = Array.isArray(raw) ? raw[0] : raw;
    if (!sessionId) redirect(route("/assessor/start"));
    return <InterviewClient sessionId={sessionId} />;
  }

  if (memberships.some((m) => m.role === "enduser")) redirect(route("/student"));

  // Signed in but no org membership and not an app admin: render a friendly
  // "no access" page. We don't redirect to /login because the user IS signed
  // in — kicking them back there would be confusing.
  return (
    <main className="min-h-dvh flex items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm border border-neutral-200 text-center">
        <h1 className="text-2xl font-semibold text-neutral-900">
          You&apos;re signed in
        </h1>
        <p className="mt-3 text-sm text-neutral-600">
          Your account isn&apos;t connected to an organization yet. Ask an admin
          to add you, or contact support if you believe this is a mistake.
        </p>
        {user.email && (
          <p className="mt-6 text-xs text-neutral-400">
            Signed in as <span className="font-medium">{user.email}</span>
          </p>
        )}
      </div>
    </main>
  );
}
