import { NextResponse } from "next/server";
import {
  getActiveLeadRun,
  toPublic,
  updateLeadRun,
  type UpdateLeadRunInput,
} from "@/lib/lead/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PatchBody {
  ageBand?: "over_18" | "under_18";
  parentalSignatureUrl?: string | null;
  consent?: boolean;
  termsVersion?: string;
  firstName?: string;
  grade?: string;
  shareWithAdvisers?: boolean;
}

/**
 * PATCH /api/lead/runs/:id
 *
 * Updates the lead row identified by the cookie. The :id param is used
 * for symmetry with the rest of the API but the cookie is what actually
 * authorizes the call.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const lead = await getActiveLeadRun();
  if (!lead) {
    return NextResponse.json({ error: "No active lead run" }, { status: 401 });
  }
  const { id } = await params;
  if (id !== lead.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as PatchBody;

  const patch: UpdateLeadRunInput = {};
  if (body.ageBand) patch.ageBand = body.ageBand;
  if (body.parentalSignatureUrl !== undefined)
    patch.parentalSignatureUrl = body.parentalSignatureUrl;
  if (body.consent) {
    patch.consentRecorded = true;
    patch.consentTermsVersion = body.termsVersion ?? "1";
  }
  if (body.firstName !== undefined) patch.firstName = body.firstName.trim();
  if (body.grade !== undefined) patch.grade = body.grade;
  if (body.shareWithAdvisers !== undefined)
    patch.shareWithAdvisers = body.shareWithAdvisers;

  const updated = await updateLeadRun(lead.id, patch);
  return NextResponse.json({ run: toPublic(updated) });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const lead = await getActiveLeadRun();
  if (!lead) return NextResponse.json({ error: "No active lead run" }, { status: 401 });
  const { id } = await params;
  if (id !== lead.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ run: toPublic(lead) });
}
