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
  geminiApiKey: () => required("GEMINI_API_KEY"),
  geminiModel: () => optional("GEMINI_MODEL", "gemini-2.5-pro"),
};

/**
 * Browser-safe public env vars. Reading these from server code is fine,
 * but they MUST be prefixed with NEXT_PUBLIC_ so Next.js inlines them
 * into client bundles. Never put a service-role key here.
 */
export const publicEnv = {
  supabaseUrl: () =>
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? required("SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
};
