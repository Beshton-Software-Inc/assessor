# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Academic Assessor is a smartphone-first web app that runs a short voice-to-voice interview between a high school student and "Alex," an AI academic counselor. The full conversation is recorded (user video + mixed audio of both speakers) and stored for later review.

## Commands

```bash
npm install            # one-time
npm run dev            # local dev server (Turbopack)
npm run build          # production build
npm run start          # run the production build
npm run lint           # next lint
npm run typecheck      # tsc --noEmit
```

Environment is configured via `.env.local` — see `.env.local.example`. The Supabase service-role key is **server-only**.

## Tech Stack

- **Next.js 15** App Router + React 19, deployed to Vercel
- **TypeScript** strict mode
- **Tailwind CSS v4** (PostCSS plugin only — no `tailwind.config.*`)
- **OpenAI Realtime API** over **WebRTC** for voice-to-voice
- **Supabase** for session metadata (Postgres) and recordings (Storage)

## Architecture

### Voice loop (the interesting part)

The browser opens a WebRTC peer connection directly to OpenAI. The server is **only** involved to mint a short-lived `client_secret` so the API key never reaches the browser.

```
[Browser]                                  [Vercel Routes]                [OpenAI Realtime]
  │                                              │                              │
  │ POST /api/sessions ─────────────────────────▶│                              │
  │ POST /api/realtime/session ─────────────────▶│  mint client_secret ────────▶│
  │ ◀────────────────────────────── clientSecret │                              │
  │                                                                             │
  │ getUserMedia → RTCPeerConnection.addTrack(mic) ────[SDP offer]─────────────▶│
  │ ◀──────────────────────────────────────────────────[SDP answer]─────────────│
  │ ⇆ AI audio + transcript events flow over peer connection                    │
  │ POST /api/sessions/[id]/upload-url ─────────▶│ signed URL ───▶ Supabase     │
  │ PUT recording.webm ─────────────────────────────────────────▶ Supabase      │
  │ POST /api/sessions/[id]/complete ───────────▶│  update row                  │
```

Token mint: `app/api/realtime/session/route.ts:1`. Direct WebRTC handshake from the browser: `lib/realtime/useInterview.ts:1`.

### Audio "tee" (no-echo design)

`lib/realtime/useInterview.ts` and `lib/realtime/recorder.ts` implement the tee:

- `getUserMedia` is called with `echoCancellation`, `noiseSuppression`, and `autoGainControl` enabled — this means AI audio coming out of the speaker is **already cancelled out** of the captured mic stream by the browser. AI audio never re-enters the AI's input.
- The mic track is added to the `RTCPeerConnection` (sent to OpenAI).
- The AI's remote audio track is piped to two destinations: a hidden `<audio>` element for the user to hear, **and** a Web Audio mixer.
- The mixer (`AudioContext.createMediaStreamDestination`) combines mic + AI audio into a single `MediaStreamTrack`.
- That mixed track + the user's video track are wrapped in a `MediaStream` and recorded with `MediaRecorder` as a single WebM/Opus file.

The recording is the only place the two voices meet. They never round-trip through the AI.

### Storage path

The browser uploads the WebM blob directly to Supabase Storage using a one-time signed URL minted at `app/api/sessions/[id]/upload-url/route.ts:1`. This bypasses Vercel's request body size cap and keeps the service role key off the client. The `complete` route then writes `recording_path`, `duration_ms`, and final stage to the `sessions` row.

For phase 2 scale (5000+ students), only `app/api/sessions/[id]/upload-url/route.ts` needs to change to swap to AWS S3 / Azure Blob — the client uses whatever signed URL it gets back.

### Auto-start constraint

iOS Safari and most mobile browsers require a user gesture before `getUserMedia` and audio playback. This is why there is a `StartGate` "Tap to begin" screen — it is the **single** required tap, and from there the AI starts speaking automatically. Do not add additional friction (login, name form, etc.) before this gate.

## Key Files

- `lib/ai/prompt.ts` — Alex's full system prompt. The 2–3-question rule and exact opening/closing lines live here. Bound to the OpenAI session at mint time.
- `lib/realtime/useInterview.ts` — the hook that owns the peer connection, mic/camera, recorder, and the full lifecycle. Most behavior changes go here.
- `lib/realtime/recorder.ts` — the audio mixer + WebM mime selection.
- `app/api/realtime/session/route.ts` — ephemeral token mint with prompt baked in.
- `app/api/sessions/*` — session CRUD + signed upload URL.
- `components/InterviewClient.tsx` — the phase state machine (idle → preparing → live → uploading → done | error).
- `supabase/migrations/0001_initial.sql` — sessions table schema.

## When making changes

- **Prompt edits** belong in `lib/ai/prompt.ts` only. Don't duplicate the prompt into the client.
- **Server routes** must use `runtime = "nodejs"` and `dynamic = "force-dynamic"` — they all touch secrets and shouldn't be cached.
- **Echo regressions**: if the AI starts hearing itself, suspect `echoCancellation: false` slipping into `getUserMedia` constraints, or AI audio being routed back into the peer connection. The mixer's destination must never be added as a track to the peer connection.
- **iOS testing** is mandatory for any change touching the StartGate, autoplay, or media constraints — desktop Chrome will hide problems that block iOS Safari.
- **Voice provider swap**: The spec lists Microsoft Voice Live as the long-term preference. To swap, replace `app/api/realtime/session/route.ts` with a Microsoft auth route and update the SDP exchange in `useInterview.ts` (Microsoft uses a different signaling flow). The recorder/UI/Supabase layers stay as-is.
