export type SessionStage = "started" | "recording" | "completed" | "aborted";

export interface SessionRow {
  id: string;
  created_at: string;
  completed_at: string | null;
  stage: SessionStage;
  recording_path: string | null;
  duration_ms: number | null;
  user_agent: string | null;
}

export interface CreateSessionResponse {
  sessionId: string;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  token: string;
  path: string;
}

export interface RealtimeTokenResponse {
  clientSecret: string;
  expiresAt: number;
  model: string;
}
