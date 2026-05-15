import * as FileSystem from 'expo-file-system';
import { supabase } from '../lib/supabase';
import { MeetingRecord, AudioChunk, ProcessingStatus } from '../types';

export async function createMeetingRecord(record: Omit<MeetingRecord, 'id'>): Promise<string> {
  const { data, error } = await supabase
    .from('meetings')
    .insert(record)
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create meeting: ${error.message}`);
  return data.id;
}

export async function updateMeetingRecord(
  id: string,
  updates: Partial<MeetingRecord>
): Promise<void> {
  const { error } = await supabase
    .from('meetings')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(`Failed to update meeting: ${error.message}`);
}

export async function uploadAudioChunk(
  chunk: AudioChunk,
  meetingId: string
): Promise<string> {
  const ext = chunk.webBlob ? 'webm' : 'm4a';
  const storagePath = `audio-chunks/${meetingId}/chunk_${chunk.index}.${ext}`;

  if (chunk.webBlob) {
    // Web: upload Blob directly
    const { error } = await supabase.storage
      .from('meeting-audio')
      .upload(storagePath, chunk.webBlob, {
        contentType: chunk.webBlob.type || 'audio/webm',
        upsert: true,
      });
    if (error) throw new Error(`Failed to upload chunk ${chunk.index}: ${error.message}`);
    return storagePath;
  }

  // Mobile: read file as base64 and convert
  const fileContent = await FileSystem.readAsStringAsync(chunk.localPath, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const byteArray = Uint8Array.from(atob(fileContent), (c) => c.charCodeAt(0));
  const { error } = await supabase.storage
    .from('meeting-audio')
    .upload(storagePath, byteArray, { contentType: 'audio/mp4', upsert: true });

  if (error) throw new Error(`Failed to upload chunk ${chunk.index}: ${error.message}`);
  return storagePath;
}

export async function deleteStorageChunk(storagePath: string): Promise<void> {
  await supabase.storage.from('meeting-audio').remove([storagePath]);
}

export async function getMeetingById(id: string): Promise<MeetingRecord | null> {
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return data as MeetingRecord;
}

export async function getUserMeetings(userId: string): Promise<MeetingRecord[]> {
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('created_by', userId)
    .order('created_at', { ascending: false });

  if (error) return [];
  return (data as MeetingRecord[]) ?? [];
}

export async function processMeetingViaEdgeFunction(
  meetingId: string,
  chunkStoragePaths: string[],
  nextSteps: string,
  onProgress: (status: ProcessingStatus) => void
): Promise<void> {
  onProgress({ stage: 'transcribing', message: 'Analysing your meeting...', progress: 25 });

  const { data, error } = await supabase.functions.invoke('process-meeting', {
    body: {
      meetingId,
      chunkStoragePaths,
      nextSteps,
    },
  });

  if (error) {
    // Try to get the real error message from the Edge Function response body
    let detail = error.message;
    try {
      const ctx = (error as any).context;
      if (ctx?.json) {
        const body = await ctx.json();
        if (body?.error) detail = body.error;
      }
    } catch { /* ignore */ }
    throw new Error(detail);
  }

  if (!data?.success) {
    throw new Error(data?.error ?? 'Unknown processing error');
  }

  onProgress({ stage: 'done', message: 'Meeting minutes ready!', progress: 100 });
}

export async function getPdfDownloadUrl(storagePath: string): Promise<string | null> {
  const { data } = supabase.storage
    .from('meeting-pdfs')
    .getPublicUrl(storagePath);

  return data?.publicUrl ?? null;
}
