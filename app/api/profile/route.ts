import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/getUser";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PatchBody {
  displayName?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
}

/**
 * Returns the current user's profile + email + memberships. The profile
 * page also reads via getUser() server-side, so this endpoint is mostly
 * here for client-side refresh after a PATCH.
 */
export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    id: user.id,
    email: user.email,
    profile: user.profile,
    memberships: user.memberships,
  });
}

/**
 * Updates the editable fields on the user's profile.
 *   - displayName / phoneNumber → profiles row, RLS enforces self-edit
 *   - email → supabase.auth.updateUser; Supabase sends a confirmation
 *     link to BOTH the old and new addresses. The new email isn't live
 *     until the user clicks confirm.
 *
 * is_app_admin is intentionally NOT writable here; the profiles_update
 * RLS policy pins it to its current server-side value.
 */
export async function PATCH(req: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, string | null> = {};
  if ("displayName" in body) {
    updates.display_name = (body.displayName ?? "").trim() || null;
  }
  if ("phoneNumber" in body) {
    const v = (body.phoneNumber ?? "").trim();
    updates.phone_number = v.length === 0 ? null : v;
  }

  let profileErr: string | null = null;
  if (Object.keys(updates).length > 0) {
    const supa = await supabaseServer();
    const { error } = await supa
      .from("profiles")
      .update(updates)
      .eq("user_id", user.id);
    if (error) profileErr = error.message;
  }

  let emailErr: string | null = null;
  let emailConfirmationSent = false;
  if (typeof body.email === "string") {
    const newEmail = body.email.trim().toLowerCase();
    if (newEmail && newEmail !== (user.email ?? "").toLowerCase()) {
      // Use the user-bound server client so Supabase tracks "old email"
      // properly and sends confirmation to both addresses. Service-role
      // would silently flip without confirmation, which is dangerous.
      const supa = await supabaseServer();
      const { error } = await supa.auth.updateUser({ email: newEmail });
      if (error) {
        emailErr = error.message;
      } else {
        emailConfirmationSent = true;
      }
    }
  }

  if (profileErr || emailErr) {
    return NextResponse.json(
      { error: profileErr ?? emailErr, profileErr, emailErr },
      { status: 400 },
    );
  }

  // Read back via the admin client to skip RLS staleness on the round trip.
  const admin = supabaseAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("user_id, display_name, phone_number, is_app_admin")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    profile,
    emailConfirmationSent,
  });
}
