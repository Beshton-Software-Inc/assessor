import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { streamSessionAsMp4 } from "@/lib/sessions/download";
import { getUser } from "@/lib/auth/getUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams a session's recording as MP4. The conversion runs in this Node
 * runtime; we re-encode and use fragmented MP4 so output can be piped without
 * a seekable destination. Suitable for local dev / a self-hosted Node deploy.
 * On Vercel serverless this will be slow and may exceed function time limits
 * for long recordings — move to a worker if that becomes an issue.
 *
 * Auth: gate on a valid session, then RLS-check that the caller can read the
 * sessions row via supabaseServer(). Only after that do we drop to
 * supabaseAdmin() to fetch the WebM from Storage and run the ffmpeg pipeline
 * (Storage download path keeps using service-role for streaming throughput).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const serverSupa = await supabaseServer();
  const { data: row } = await serverSupa
    .from("sessions")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json(
      { error: "Forbidden: session not visible" },
      { status: 403 },
    );
  }

  try {
    const { session, mp4 } = await streamSessionAsMp4(supabaseAdmin(), id);
    const webStream = Readable.toWeb(mp4) as unknown as ReadableStream<Uint8Array>;
    const filename = `session-${session.id}.mp4`;
    return new Response(webStream, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to convert recording", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
