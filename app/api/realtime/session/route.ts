import { NextResponse } from "next/server";
import { ALEX_SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { serverEnv } from "@/lib/env";
import { getUser } from "@/lib/auth/getUser";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RealtimeBody {
  sessionId?: string;
}

/**
 * Mints a short-lived OpenAI Realtime client_secret so the browser can open a
 * WebRTC peer connection directly to OpenAI without ever seeing the API key.
 * The system prompt is bound to the session at mint time.
 *
 * Authenticated callers only. If the body carries a `sessionId` we verify the
 * caller can read that session row (RLS-gated) before minting — otherwise an
 * attacker who knew about a session id could burn OpenAI tokens for it.
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Body is optional — older clients call this with no payload. If present
  // and a sessionId is supplied, do the RLS-gated read.
  const body = (await req.json().catch(() => ({}))) as RealtimeBody;
  if (body.sessionId) {
    const supa = await supabaseServer();
    const { data: row } = await supa
      .from("sessions")
      .select("id")
      .eq("id", body.sessionId)
      .maybeSingle();
    if (!row) {
      return NextResponse.json(
        { error: "Forbidden: session not visible" },
        { status: 403 },
      );
    }
  }

  const apiKey = serverEnv.openaiApiKey();
  const model = serverEnv.openaiModel();
  const voice = serverEnv.openaiVoice();

  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model,
        instructions: ALEX_SYSTEM_PROMPT,
        output_modalities: ["audio"],
        audio: {
          input: {
            transcription: { model: "gpt-4o-transcribe" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 600,
            },
          },
          output: { voice },
        },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json(
      { error: "Failed to create realtime session", detail },
      { status: 502 },
    );
  }

  const data = (await res.json()) as {
    value: string;
    expires_at: number;
    session?: { model?: string };
  };

  return NextResponse.json({
    clientSecret: data.value,
    expiresAt: data.expires_at,
    model: data.session?.model ?? model,
  });
}
