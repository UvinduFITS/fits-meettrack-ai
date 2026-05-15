-- ============================================================
-- FITS MeetTrack AI — Row Level Security Policies
-- Run this after 001_initial_schema.sql
-- ============================================================

-- ── Enable RLS ─────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.temporary_audio_chunks ENABLE ROW LEVEL SECURITY;

-- ── profiles ────────────────────────────────────────────────
-- Users can read their own profile
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Admins can read all profiles
CREATE POLICY "profiles_admin_select_all"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ── meetings ────────────────────────────────────────────────
-- Users can read their own meetings
CREATE POLICY "meetings_select_own"
  ON public.meetings FOR SELECT
  USING (auth.uid() = created_by);

-- Users can insert their own meetings
CREATE POLICY "meetings_insert_own"
  ON public.meetings FOR INSERT
  WITH CHECK (auth.uid() = created_by);

-- Users can update their own meetings
CREATE POLICY "meetings_update_own"
  ON public.meetings FOR UPDATE
  USING (auth.uid() = created_by);

-- Admins can read all meetings
CREATE POLICY "meetings_admin_select_all"
  ON public.meetings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Service role can update meetings (for edge function)
-- This is handled automatically by service role key bypassing RLS

-- ── temporary_audio_chunks ─────────────────────────────────
-- Users can manage chunks for their own meetings
CREATE POLICY "chunks_select_own"
  ON public.temporary_audio_chunks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.meetings
      WHERE id = meeting_id AND created_by = auth.uid()
    )
  );

CREATE POLICY "chunks_insert_own"
  ON public.temporary_audio_chunks FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meetings
      WHERE id = meeting_id AND created_by = auth.uid()
    )
  );

CREATE POLICY "chunks_update_own"
  ON public.temporary_audio_chunks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.meetings
      WHERE id = meeting_id AND created_by = auth.uid()
    )
  );

CREATE POLICY "chunks_delete_own"
  ON public.temporary_audio_chunks FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.meetings
      WHERE id = meeting_id AND created_by = auth.uid()
    )
  );
