import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CompleteBody {
  recordingPath?: string;
  durationMs?: number;
  aborted?: boolean;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as CompleteBody;

  const supabase = supabaseAdmin();
  const { error } = await supabase
    .from("sessions")
    .update({
      stage: body.aborted ? "aborted" : "completed",
      completed_at: new Date().toISOString(),
      recording_path: body.recordingPath ?? null,
      duration_ms: body.durationMs ?? null,
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to complete session", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
