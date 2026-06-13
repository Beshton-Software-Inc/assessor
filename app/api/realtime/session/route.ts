import { NextResponse } from "next/server";
import { ALEX_SYSTEM_PROMPT, ALEX_QA_SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { serverEnv } from "@/lib/env";
import { getUser } from "@/lib/auth/getUser";
import { supabaseServer } from "@/lib/supabase/server";
import { getActiveLeadRun } from "@/lib/lead/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RealtimeBody {
  sessionId?: string;
  // 'qa' selects the page-6 follow-up persona; default is the original Alex.
  persona?: "default" | "qa";
}

/**
 * Mints a short-lived OpenAI Realtime client_secret so the browser can open a
 * WebRTC peer connection directly to OpenAI without ever seeing the API key.
 *
 * Allowed callers: an authenticated user OR an anonymous /lead caller whose
 * lead cookie owns the requested sessionId. Without a sessionId we still
 * require a valid identity so a leaked endpoint can't burn OpenAI tokens.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as RealtimeBody;

  const user = await getUser();
  const lead = user ? null : await getActiveLeadRun();

  if (!user && !lead) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (body.sessionId) {
    if (user) {
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
    } else if (lead) {
      const owns =
        lead.presentation_session_id === body.sessionId ||
        lead.qa_session_id === body.sessionId;
      if (!owns) {
        return NextResponse.json(
          { error: "Forbidden: session not in lead run" },
          { status: 403 },
        );
      }
    }
  }

  const apiKey = serverEnv.openaiApiKey();
  const model = serverEnv.openaiModel();
  const voice = serverEnv.openaiVoice();
  const instructions =
    body.persona === "qa" ? ALEX_QA_SYSTEM_PROMPT : ALEX_SYSTEM_PROMPT;

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
        instructions,
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
