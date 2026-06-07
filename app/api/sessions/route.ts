import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { listDownloadableSessions } from "@/lib/sessions/download";
import type { CreateSessionResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
  try {
    const sessions = await listDownloadableSessions(supabaseAdmin(), limit);
    return NextResponse.json({ sessions });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to list sessions", detail: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const userAgent = req.headers.get("user-agent");
  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("sessions")
    .insert({ stage: "started", user_agent: userAgent })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create session", detail: error?.message },
      { status: 500 },
    );
  }

  return NextResponse.json<CreateSessionResponse>({ sessionId: data.id });
}
