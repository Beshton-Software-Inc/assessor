-- Add phone_number to profiles for the user-facing profile page.
-- Email + role + memberships are already available elsewhere
-- (auth.users.email, org_members.role) so they don't need columns here.
--
-- The profiles_update policy from 0003 already allows self-edits as long
-- as is_app_admin isn't changed; phone_number falls under that and needs
-- no policy change.

alter table public.profiles
  add column if not exists phone_number text;
