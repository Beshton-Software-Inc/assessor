import { NextResponse } from "next/server";
import { createLeadRun, getActiveLeadRun, toPublic } from "@/lib/lead/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/lead/runs
 *
 * Idempotent: returns the existing active run if the cookie matches one,
 * otherwise creates a fresh one and sets the signed cookie. Anonymous —
 * no auth required.
 */
export async function POST() {
  const existing = await getActiveLeadRun();
  if (existing) {
    return NextResponse.json({ run: toPublic(existing) });
  }
  const { row } = await createLeadRun();
  return NextResponse.json({ run: toPublic(row) }, { status: 201 });
}

export async function GET() {
  const row = await getActiveLeadRun();
  if (!row) return NextResponse.json({ run: null });
  return NextResponse.json({ run: toPublic(row) });
}
