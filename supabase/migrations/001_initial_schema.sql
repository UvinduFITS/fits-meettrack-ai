-- ============================================================
-- FITS MeetTrack AI — Initial Database Schema
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── profiles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     TEXT,
  email         TEXT,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── meetings ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meetings (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_title           TEXT NOT NULL,
  client_name             TEXT NOT NULL,
  attendees               JSONB NOT NULL DEFAULT '[]',
  prepared_by             TEXT NOT NULL,
  start_time              TIMESTAMPTZ NOT NULL,
  end_time                TIMESTAMPTZ NOT NULL,
  duration_seconds        INTEGER NOT NULL DEFAULT 0,
  meeting_date            DATE NOT NULL,
  latitude                DOUBLE PRECISION,
  longitude               DOUBLE PRECISION,
  address                 TEXT,
  transcript              TEXT,
  agenda                  JSONB,
  summary                 TEXT,
  key_discussion_points   JSONB,
  decisions               JSONB,
  action_items            JSONB,
  next_steps              TEXT,
  pdf_url                 TEXT,
  status                  TEXT NOT NULL DEFAULT 'recording'
                          CHECK (status IN ('recording', 'processing', 'completed', 'failed')),
  created_by              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meetings_updated_at ON public.meetings;
CREATE TRIGGER meetings_updated_at
  BEFORE UPDATE ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── temporary_audio_chunks ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.temporary_audio_chunks (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id    UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,
  local_path    TEXT,
  storage_path  TEXT,
  processed     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS meetings_created_by_idx ON public.meetings (created_by);
CREATE INDEX IF NOT EXISTS meetings_status_idx ON public.meetings (status);
CREATE INDEX IF NOT EXISTS meetings_meeting_date_idx ON public.meetings (meeting_date DESC);
CREATE INDEX IF NOT EXISTS chunks_meeting_id_idx ON public.temporary_audio_chunks (meeting_id);
