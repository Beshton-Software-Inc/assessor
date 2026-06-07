import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/getUser";
import { getAssessorOrgId } from "@/lib/auth/roles";
import { startSession } from "@/lib/pairing/sessions";
import type { CreateSessionResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sessions/start  body: { enduserUserId: string }
 *
 * Canonical Phase B entry point for assessor-initiated interviews. Creates
 * a sessions row with the proper enduser_id (NOT the assessor's own id).
 * Validates that the chosen enduser is an enduser member of the same org
 * as the calling assessor — refuses cross-org pairing.
 */

interface StartBody {
  enduserUserId?: string;
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

  const body = (await req.json().catch(() => ({}))) as StartBody;
  const enduserUserId = (body.enduserUserId ?? "").trim();
  if (!enduserUserId) {
    return NextResponse.json(
      { error: "enduserUserId required" },
      { status: 400 },
    );
  }

  const userAgent = req.headers.get("user-agent");
  try {
    const { sessionId } = await startSession({
      assessorUserId: user.id,
      enduserUserId,
      orgId,
      userAgent,
    });
    return NextResponse.json<CreateSessionResponse>({ sessionId });
  } catch (err) {
    const msg = (err as Error).message;
    // Surface the cross-org / membership refusals as 403 so the UI can
    // distinguish them from infrastructure errors.
    if (msg.includes("not an assessor") || msg.includes("not a member")) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Failed to start session", detail: msg },
      { status: 500 },
    );
  }
}
