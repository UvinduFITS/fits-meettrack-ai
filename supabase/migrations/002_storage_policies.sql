-- Allow authenticated users to upload audio chunks to meeting-audio bucket
DO $$ BEGIN
  CREATE POLICY "auth_upload_audio" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'meeting-audio');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allow authenticated users to read audio chunks
DO $$ BEGIN
  CREATE POLICY "auth_read_audio" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'meeting-audio');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allow authenticated users to delete audio chunks
DO $$ BEGIN
  CREATE POLICY "auth_delete_audio" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'meeting-audio');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Make meeting-pdfs bucket public so direct download links work
UPDATE storage.buckets SET public = true WHERE id = 'meeting-pdfs';

-- Allow authenticated users to read PDFs
DO $$ BEGIN
  CREATE POLICY "auth_read_pdfs" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'meeting-pdfs');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
