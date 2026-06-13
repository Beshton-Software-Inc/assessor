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

export type LeadAgeBand = "over_18" | "under_18";

export interface LeadRunRow {
  id: string;
  created_at: string;
  expires_at: string;
  claimed_at: string | null;
  age_band: LeadAgeBand | null;
  parental_signature_url: string | null;
  consent_recorded_at: string | null;
  consent_terms_version: string | null;
  first_name: string | null;
  grade: string | null;
  share_with_advisers: boolean | null;
  presentation_session_id: string | null;
  qa_session_id: string | null;
  user_id: string | null;
}

export interface LeadRunPublic {
  id: string;
  ageBand: LeadAgeBand | null;
  consentRecordedAt: string | null;
  firstName: string | null;
  grade: string | null;
  shareWithAdvisers: boolean | null;
  presentationSessionId: string | null;
  qaSessionId: string | null;
  claimed: boolean;
}

export interface LeadSessionResponse {
  sessionId: string;
}

