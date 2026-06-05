import { NextResponse } from "next/server";
import { ALEX_SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mints a short-lived OpenAI Realtime client_secret so the browser can open a
 * WebRTC peer connection directly to OpenAI without ever seeing the API key.
 * The system prompt is bound to the session at mint time.
 */
export async function POST() {
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
