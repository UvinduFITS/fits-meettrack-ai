-- ============================================================
-- FITS MeetTrack AI — Supabase Storage Setup
-- Run in Supabase SQL Editor after enabling Storage
-- ============================================================

-- Create buckets via Supabase Dashboard or use API.
-- These SQL commands configure policies for existing buckets.

-- Bucket 1: meeting-audio  (private — for temporary audio chunks)
-- Bucket 2: meeting-pdfs   (public — for generated PDFs)

-- Create buckets if using supabase CLI:
-- supabase storage create meeting-audio --no-public
-- supabase storage create meeting-pdfs --public

-- ── Storage RLS for meeting-audio bucket ───────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('meeting-audio', 'meeting-audio', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('meeting-pdfs', 'meeting-pdfs', true)
ON CONFLICT (id) DO NOTHING;

-- Users can upload audio to their own folder
CREATE POLICY "audio_upload_own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'meeting-audio'
    AND auth.role() = 'authenticated'
  );

-- Only service role can read audio (for edge function)
-- anon cannot access audio
CREATE POLICY "audio_read_authenticated"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'meeting-audio'
    AND auth.role() = 'authenticated'
  );

-- Users can delete their audio
CREATE POLICY "audio_delete_authenticated"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'meeting-audio'
    AND auth.role() = 'authenticated'
  );

-- Anyone can read PDFs (they have UUID-based paths)
CREATE POLICY "pdfs_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'meeting-pdfs');

-- Authenticated users can manage PDFs
CREATE POLICY "pdfs_authenticated_write"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'meeting-pdfs'
    AND auth.role() = 'authenticated'
  );
