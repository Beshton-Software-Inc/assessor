import { NextResponse } from "next/server";
import { runAnalysis } from "@/lib/analysis/analyze";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // up to 10 minutes; Gemini video calls can be slow

/**
 * Triggers a Gemini video analysis for a recorded session.
 * Synchronous: holds the request open until the analysis row + PDF are written.
 * For background execution, swap to a queue/worker. Suitable for an internal
 * admin tool but not a public endpoint.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const { analysis } = await runAnalysis(supabaseAdmin(), id);
    return NextResponse.json({ analysis });
  } catch (err) {
    return NextResponse.json(
      { error: "Analysis failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
