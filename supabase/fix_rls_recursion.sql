-- ============================================================
-- FIX: Remove recursive RLS policies and replace with
-- a SECURITY DEFINER function to avoid infinite loops
-- Run this in Supabase SQL Editor
-- ============================================================

-- Step 1: Drop the broken recursive policies
DROP POLICY IF EXISTS "profiles_admin_select_all" ON public.profiles;
DROP POLICY IF EXISTS "meetings_admin_select_all" ON public.meetings;

-- Step 2: Create a security definer function (runs as postgres, bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Step 3: Recreate admin policies using the function (no more recursion)
CREATE POLICY "profiles_admin_select_all"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

CREATE POLICY "meetings_admin_select_all"
  ON public.meetings FOR SELECT
  USING (public.is_admin());
