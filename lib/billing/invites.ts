import "server-only";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getAppOrigin } from "@/lib/billing/stripe";
import type { SeatInviteRow } from "@/lib/billing/types";

export class InviteError extends Error {
  constructor(
    public code:
      | "invalid_email"
      | "already_member"
      | "not_found"
      | "already_accepted"
      | "expired"
      | "revoked"
      | "email_mismatch"
      | "internal",
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface CreateInviteInput {
  orgId: string;
  email: string;
  role: "assessor" | "org_admin";
  invitedByUserId: string;
}

function isLikelyEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function makeToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Idempotent: if a pending invite already exists for (org_id, lower(email))
 * we return that row instead of creating a duplicate. The Supabase auth
 * inviteUserByEmail call is best-effort; if it fails we still keep the
 * pending row so the org admin can resend / revoke later.
 */
export async function createInvite(
  input: CreateInviteInput,
): Promise<{ invite: SeatInviteRow }> {
  const email = input.email.trim().toLowerCase();
  if (!isLikelyEmail(email)) {
    throw new InviteError("invalid_email");
  }
  const admin = supabaseAdmin();

  // Refuse if the email already belongs to a member of this org.
  // We look up auth.users by email via the admin API.
  const { data: usersList } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  const existingUser = usersList?.users.find(
    (u) => (u.email ?? "").toLowerCase() === email,
  );
  if (existingUser) {
    const { data: existingMember } = await admin
      .from("org_members")
      .select("user_id")
      .eq("org_id", input.orgId)
      .eq("user_id", existingUser.id)
      .maybeSingle();
    if (existingMember) throw new InviteError("already_member");
  }

  // Reuse existing pending invite if any.
  const { data: existing } = await admin
    .from("seat_invites")
    .select("*")
    .eq("org_id", input.orgId)
    .eq("status", "pending")
    .ilike("email", email)
    .maybeSingle();
  if (existing) {
    return { invite: existing as SeatInviteRow };
  }

  const token = makeToken();
  const { data: inserted, error: insertErr } = await admin
    .from("seat_invites")
    .insert({
      org_id: input.orgId,
      invited_by: input.invitedByUserId,
      email,
      role: input.role,
      token,
      status: "pending",
    })
    .select("*")
    .single();
  if (insertErr) throw new InviteError("internal", insertErr.message);

  // Send the magic link. If email is already an auth user, we use
  // generateLink so they don't get a confusing "create account" message;
  // otherwise inviteUserByEmail to provision the user.
  const redirectTo = `${getAppOrigin()}/auth/callback?invite=${encodeURIComponent(
    token,
  )}&next=${encodeURIComponent("/admin/billing")}`;
  try {
    if (existingUser) {
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo },
      });
    } else {
      await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { invite_token: token },
      });
    }
  } catch {
    // Swallow: the row is in pending state and can be resent via a
    // future "resend" action. Don't fail the API call entirely.
  }

  return { invite: inserted as SeatInviteRow };
}

export async function revokeInvite({
  inviteId,
  orgId,
}: {
  inviteId: string;
  orgId: string;
}): Promise<{ ok: true }> {
  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from("seat_invites")
    .select("*")
    .eq("id", inviteId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!row) throw new InviteError("not_found");
  const inv = row as SeatInviteRow;
  if (inv.status === "accepted") throw new InviteError("already_accepted");
  if (inv.status === "revoked") return { ok: true };
  const { error } = await admin
    .from("seat_invites")
    .update({ status: "revoked" })
    .eq("id", inviteId);
  if (error) throw new InviteError("internal", error.message);
  return { ok: true };
}

/**
 * Called from /auth/callback after the user has exchanged their auth code
 * for a session. Looks up the invite by token, verifies the email matches,
 * inserts the org_members row, and flips status to 'accepted'.
 *
 * Idempotent: if the membership already exists (e.g. they accepted and
 * then clicked the link again), we no-op rather than error.
 */
export async function acceptInviteOnAuth({
  token,
  userId,
  email,
}: {
  token: string;
  userId: string;
  email: string | null;
}): Promise<{ orgId: string; role: "assessor" | "org_admin" }> {
  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from("seat_invites")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (!row) throw new InviteError("not_found");
  const inv = row as SeatInviteRow;

  if (inv.status === "revoked") throw new InviteError("revoked");
  if (inv.status === "expired") throw new InviteError("expired");
  if (inv.status === "accepted") {
    return { orgId: inv.org_id, role: inv.role };
  }
  if (
    !email ||
    email.toLowerCase().trim() !== inv.email.toLowerCase().trim()
  ) {
    throw new InviteError("email_mismatch");
  }

  await admin
    .from("org_members")
    .upsert(
      { org_id: inv.org_id, user_id: userId, role: inv.role },
      { onConflict: "org_id,user_id", ignoreDuplicates: true },
    );

  await admin
    .from("seat_invites")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", inv.id);

  return { orgId: inv.org_id, role: inv.role };
}
