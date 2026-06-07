import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/getUser";
import { getAssessorOrgId } from "@/lib/auth/roles";
import {
  createOrgEnduser,
  listOrgEndusers,
  type OrgEnduser,
} from "@/lib/pairing/endusers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/pairing/endusers?q=...&limit=50
 *   List endusers in the caller's assessor org.
 *
 * POST /api/pairing/endusers  body: { email, displayName }
 *   Idempotently provisions an enduser and adds them to the assessor's org.
 *
 * Both routes are gated to assessor-on-org. Reads/writes are scoped to the
 * resolved org_id; cross-org pairing is a Phase C feature.
 */

interface CreateEnduserBody {
  email?: string;
  displayName?: string;
}

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = await getAssessorOrgId(user.id);
  if (!orgId) {
    return NextResponse.json(
      { error: "Forbidden: not an assessor in any organization" },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);

  // Use the admin client; we constrain every query to the resolved org_id.
  const endusers: OrgEnduser[] = await listOrgEndusers(supabaseAdmin(), orgId, q, limit);
  return NextResponse.json({ endusers });
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = await getAssessorOrgId(user.id);
  if (!orgId) {
    return NextResponse.json(
      { error: "Forbidden: not an assessor in any organization" },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as CreateEnduserBody;
  const email = (body.email ?? "").trim();
  const displayName = (body.displayName ?? "").trim();
  if (!email || !displayName) {
    return NextResponse.json(
      { error: "email and displayName required" },
      { status: 400 },
    );
  }

  try {
    const result = await createOrgEnduser(orgId, email, displayName);
    const status = result.alreadyExisted ? 409 : 200;
    return NextResponse.json(result, { status });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create enduser", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
