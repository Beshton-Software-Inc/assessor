function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const serverEnv = {
  openaiApiKey: () => required("OPENAI_API_KEY"),
  openaiModel: () => optional("OPENAI_REALTIME_MODEL", "gpt-realtime-2"),
  openaiVoice: () => optional("OPENAI_REALTIME_VOICE", "marin"),
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  recordingsBucket: () => optional("SUPABASE_RECORDINGS_BUCKET", "recordings"),
};
