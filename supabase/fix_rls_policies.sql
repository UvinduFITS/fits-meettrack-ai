-- ============================================================
-- FIX: Complete RLS policies for profiles and meetings
-- Run this in Supabase SQL Editor
-- ============================================================

-- Ensure RLS is enabled on both tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings  ENABLE ROW LEVEL SECURITY;

-- ── profiles ────────────────────────────────────────────────
-- Drop existing policies so we can recreate cleanly
DROP POLICY IF EXISTS "profiles_select_own"        ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own"         ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own"         ON public.profiles;

-- Users can read and update their own profile
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid());

-- The handle_new_user() trigger inserts profiles as postgres (bypasses RLS),
-- but add an INSERT policy as a safety net for direct inserts
CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- ── meetings ────────────────────────────────────────────────
-- Drop existing user-level policies so we can recreate cleanly
DROP POLICY IF EXISTS "meetings_insert_own"         ON public.meetings;
DROP POLICY IF EXISTS "meetings_select_own"         ON public.meetings;
DROP POLICY IF EXISTS "meetings_update_own"         ON public.meetings;
DROP POLICY IF EXISTS "meetings_delete_own"         ON public.meetings;

-- Users can INSERT their own meetings
CREATE POLICY "meetings_insert_own"
  ON public.meetings FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- Users can SELECT their own meetings
CREATE POLICY "meetings_select_own"
  ON public.meetings FOR SELECT
  USING (created_by = auth.uid());

-- Users can UPDATE their own meetings
CREATE POLICY "meetings_update_own"
  ON public.meetings FOR UPDATE
  USING (created_by = auth.uid());

-- Users can DELETE their own meetings
CREATE POLICY "meetings_delete_own"
  ON public.meetings FOR DELETE
  USING (created_by = auth.uid());

-- Admin SELECT policies (keep from fix_rls_recursion.sql — recreated here for completeness)
DROP POLICY IF EXISTS "profiles_admin_select_all"   ON public.profiles;
DROP POLICY IF EXISTS "meetings_admin_select_all"    ON public.meetings;

CREATE POLICY "profiles_admin_select_all"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

CREATE POLICY "meetings_admin_select_all"
  ON public.meetings FOR SELECT
  USING (public.is_admin());
