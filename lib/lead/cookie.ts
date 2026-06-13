import "server-only";
import { cookies } from "next/headers";

export const LEAD_COOKIE = "lead_run";
const COOKIE_MAX_AGE_S = 60 * 60 * 24; // 24h, matches lead_runs.expires_at

export interface LeadCookieValue {
  id: string;
  token: string;
}

/**
 * Encoded as `<id>.<token>` so we can read/write it with the standard cookie
 * jar. The token is the random `cookie_token` stored on the lead_runs row;
 * a stolen id alone won't authorize anything.
 */
function encode(v: LeadCookieValue): string {
  return `${v.id}.${v.token}`;
}

function decode(raw: string | undefined): LeadCookieValue | null {
  if (!raw) return null;
  const idx = raw.indexOf(".");
  if (idx < 0) return null;
  const id = raw.slice(0, idx);
  const token = raw.slice(idx + 1);
  if (!id || !token) return null;
  return { id, token };
}

export async function readLeadCookie(): Promise<LeadCookieValue | null> {
  const jar = await cookies();
  return decode(jar.get(LEAD_COOKIE)?.value);
}

export async function writeLeadCookie(v: LeadCookieValue): Promise<void> {
  const jar = await cookies();
  jar.set(LEAD_COOKIE, encode(v), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_S,
  });
}

export async function clearLeadCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(LEAD_COOKIE);
}
