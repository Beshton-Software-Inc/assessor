import Link from "next/link";
import type { Route } from "next";
import { requireRole } from "@/lib/auth/requireRole";
import { getAssessorOrgId } from "@/lib/auth/roles";
import { supabaseAdmin } from "@/lib/supabase/server";
import { listOrgEndusers, type OrgEnduser } from "@/lib/pairing/endusers";
import { UserMenu } from "@/components/UserMenu";
import { EnduserPicker } from "./EnduserPicker";
import { InviteNewStudent } from "./InviteNewStudent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StartPageProps {
  searchParams: Promise<{ orgId?: string | string[] }>;
}

/**
 * Pre-interview pairing screen.
 *
 * Server component, requireRole('assessor'). Resolves the assessor's primary
 * org (or honors ?orgId for app_admin / multi-org assessors), server-fetches
 * the enduser list via the pairing helper (no self-fetch round-trip), and
 * hydrates two client subcomponents: a searchable picker and an invite form.
 *
 * Selection POSTs to /api/sessions/start, then router.push('/?sessionId=...')
 * — the interview UI on `/` consumes the pre-created session id and skips
 * its own create-session step.
 */
export default async function AssessorStartPage({ searchParams }: StartPageProps) {
  const user = await requireRole("assessor");

  const params = await searchParams;
  const requestedOrgId = (() => {
    const v = params.orgId;
    if (Array.isArray(v)) return v[0];
    return v;
  })();

  // Default to the assessor's first assessor membership; honor an explicit
  // ?orgId only if the caller actually has an assessor row in that org.
  const primaryOrgId = await getAssessorOrgId(user.id);
  const orgId =
    requestedOrgId &&
    user.memberships.some(
      (m) => m.org_id === requestedOrgId && m.role === "assessor",
    )
      ? requestedOrgId
      : primaryOrgId;

  if (!orgId) {
    // requireRole already verified at least one assessor membership, so this
    // is the rare race where it was just revoked. Fail soft.
    return (
      <main className="min-h-dvh flex items-center justify-center bg-neutral-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-neutral-900">No org</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Your account is no longer an assessor in any organization.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Link
              href={"/assessor" as Route}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Back
            </Link>
            <UserMenu
              displayName={user.profile?.display_name}
              email={user.email}
            />
          </div>
        </div>
      </main>
    );
  }

  // Server-side fetch of the enduser list. Use the admin client; the helper
  // pulls org_members + profiles + auth.users emails. Every query is scoped
  // to orgId, so privilege escalation isn't a risk.
  let initialEndusers: OrgEnduser[] = [];
  let listError: string | null = null;
  try {
    initialEndusers = await listOrgEndusers(supabaseAdmin(), orgId, undefined, 50);
  } catch (err) {
    listError = (err as Error).message;
  }

  const displayName = user.profile?.display_name ?? user.email ?? "Assessor";

  return (
    <main className="min-h-dvh bg-neutral-50">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-neutral-500">Start a new interview</p>
            <h1 className="mt-1 text-2xl font-semibold text-neutral-900">
              Choose a student
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              Signed in as {displayName}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={"/assessor" as Route}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Back to assessor home
            </Link>
            <UserMenu
              displayName={user.profile?.display_name}
              email={user.email}
            />
          </div>
        </div>

        {listError && (
          <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Failed to load students: {listError}
          </p>
        )}

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            <div className="border-b border-neutral-200 px-5 py-3">
              <h2 className="text-sm font-medium text-neutral-700">
                Pick a student
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                Search your students, then click to start the interview.
              </p>
            </div>
            <EnduserPicker initialEndusers={initialEndusers} />
          </section>

          <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            <div className="border-b border-neutral-200 px-5 py-3">
              <h2 className="text-sm font-medium text-neutral-700">
                Invite a new student
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                We&apos;ll add them to your organization and pair them for this
                interview.
              </p>
            </div>
            <InviteNewStudent />
          </section>
        </div>
      </div>
    </main>
  );
}
