import { useRef, useCallback, useEffect } from 'react';
import {
  useAudioRecorder,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  IOSOutputFormat,
  AudioQuality,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { useMeetingStore } from '../stores/meetingStore';
import { AudioChunk } from '../types';

const CHUNK_DURATION_MS = 10 * 60 * 1000;

const RECORDING_OPTIONS = {
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 64000,
  android: {
    outputFormat: 'mpeg4' as const,
    audioEncoder: 'aac' as const,
  },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {},
};

export function useAudioRecording() {
  const chunkIndexRef          = useRef(0);
  const elapsedTimerRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedSecondsRef      = useRef(0);
  const isStoppingRef          = useRef(false);
  // Track whether the native recorder is actually recording (don't rely on React state).
  const isNativeRecordingRef   = useRef(false);
  // Cache the last URI emitted by the recorder (recorder.uri may update async via React state).
  const lastRecorderUriRef     = useRef<string | null>(null);

  // Mobile (expo-audio)
  const recorder      = useAudioRecorder(RECORDING_OPTIONS);
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Web (MediaRecorder)
  const webRecorderRef   = useRef<MediaRecorder | null>(null);
  const webStreamRef     = useRef<MediaStream | null>(null);
  const webChunkDataRef  = useRef<Blob[]>([]);
  const webChunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addAudioChunk       = useMeetingStore((s) => s.addAudioChunk);
  const setRecordingElapsed = useMeetingStore((s) => s.setRecordingElapsed);
  const setIsRecording      = useMeetingStore((s) => s.setIsRecording);

  // Keep lastRecorderUriRef in sync whenever recorder.uri updates via React state.
  useEffect(() => {
    if (recorder.uri) lastRecorderUriRef.current = recorder.uri;
  }, [recorder.uri]);

  // ── Web helpers ──────────────────────────────────────────────────────────────

  const finalizeWebChunk = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      const rec = webRecorderRef.current;
      if (!rec || rec.state === 'inactive') { resolve(); return; }

      rec.addEventListener('stop', () => {
        const blob = new Blob(webChunkDataRef.current, { type: rec.mimeType || 'audio/webm' });
        if (blob.size > 1000) {
          addAudioChunk({
            index: chunkIndexRef.current,
            localPath: '',
            storagePath: null,
            processed: false,
            webBlob: blob,
          });
          chunkIndexRef.current += 1;
        }
        webChunkDataRef.current = [];
        webRecorderRef.current = null;
        resolve();
      }, { once: true });

      rec.stop();
    });
  }, [addAudioChunk]);

  const startWebChunk = useCallback(async () => {
    if (isStoppingRef.current || !webStreamRef.current) return;

    const rec = new MediaRecorder(webStreamRef.current);
    webChunkDataRef.current = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) webChunkDataRef.current.push(e.data); };
    rec.start(1000);
    webRecorderRef.current = rec;

    webChunkTimerRef.current = setTimeout(async () => {
      if (isStoppingRef.current) return;
      await finalizeWebChunk();
      await startWebChunk();
    }, CHUNK_DURATION_MS);
  }, [finalizeWebChunk]);

  // ── Mobile helpers ────────────────────────────────────────────────────────────

  const stopCurrentRecordingChunk = useCallback(async (): Promise<string | null> => {
    if (!isNativeRecordingRef.current) return null;
    isNativeRecordingRef.current = false;
    lastRecorderUriRef.current = null; // clear so we detect the new URI
    try {
      await recorder.stop();
      // recorder.uri may be set asynchronously via React state after stop() resolves.
      // Poll for up to 1.5 s to give it time to propagate.
      for (let i = 0; i < 15; i++) {
        const uri = lastRecorderUriRef.current ?? recorder.uri ?? null;
        if (uri) return uri;
        await new Promise<void>((r) => setTimeout(r, 100));
      }
      return lastRecorderUriRef.current ?? recorder.uri ?? null;
    } catch (e) {
      console.error('[Audio] stop error:', e);
      return null;
    }
  }, [recorder]);

  const startNewChunk = useCallback(async () => {
    if (isStoppingRef.current) return;
    await recorder.prepareToRecordAsync();
    recorder.record();
    isNativeRecordingRef.current = true;

    chunkTimerRef.current = setTimeout(async () => {
      if (isStoppingRef.current) return;
      const uri = await stopCurrentRecordingChunk();
      if (uri) {
        addAudioChunk({ index: chunkIndexRef.current, localPath: uri, storagePath: null, processed: false });
        chunkIndexRef.current += 1;
      }
      await startNewChunk();
    }, CHUNK_DURATION_MS);
  }, [recorder, stopCurrentRecordingChunk, addAudioChunk]);

  // ── Public API ────────────────────────────────────────────────────────────────

  const startRecording = useCallback(async (): Promise<boolean> => {
    try {
      isStoppingRef.current    = false;
      chunkIndexRef.current    = 0;
      elapsedSecondsRef.current = 0;

      if (Platform.OS === 'web') {
        const stream = await (navigator.mediaDevices as any).getUserMedia({ audio: true });
        webStreamRef.current = stream as MediaStream;
        await startWebChunk();
      } else {
        const { granted } = await requestRecordingPermissionsAsync();
        if (!granted) return false;
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await startNewChunk();
      }

      setIsRecording(true);
      elapsedTimerRef.current = setInterval(() => {
        elapsedSecondsRef.current += 1;
        setRecordingElapsed(elapsedSecondsRef.current);
      }, 1000);
      return true;
    } catch (err) {
      console.error('Failed to start recording:', err);
      return false;
    }
  }, [startNewChunk, startWebChunk, setIsRecording, setRecordingElapsed]);

  const stopRecording = useCallback(async (): Promise<AudioChunk[]> => {
    isStoppingRef.current = true;

    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }

    if (Platform.OS === 'web') {
      if (webChunkTimerRef.current) { clearTimeout(webChunkTimerRef.current); webChunkTimerRef.current = null; }
      await finalizeWebChunk();
      webStreamRef.current?.getTracks().forEach((t) => t.stop());
      webStreamRef.current = null;
    } else {
      if (chunkTimerRef.current) { clearTimeout(chunkTimerRef.current); chunkTimerRef.current = null; }
      const uri = await stopCurrentRecordingChunk();
      if (uri) {
        const lastChunk: AudioChunk = { index: chunkIndexRef.current, localPath: uri, storagePath: null, processed: false };
        addAudioChunk(lastChunk);
      }
      try { await setAudioModeAsync({ allowsRecording: false }); } catch { /* ignore */ }
    }

    setIsRecording(false);
    return useMeetingStore.getState().audioChunks;
  }, [stopCurrentRecordingChunk, finalizeWebChunk, addAudioChunk, setIsRecording]);

  const cleanupLocalAudio = useCallback(async (chunks: AudioChunk[]) => {
    for (const chunk of chunks) {
      if (!chunk.localPath) continue;
      try {
        const info = await FileSystem.getInfoAsync(chunk.localPath);
        if (info.exists) await FileSystem.deleteAsync(chunk.localPath, { idempotent: true });
      } catch { /* best-effort */ }
    }
  }, []);

  useEffect(() => {
    return () => {
      if (chunkTimerRef.current)    clearTimeout(chunkTimerRef.current);
      if (webChunkTimerRef.current) clearTimeout(webChunkTimerRef.current);
      if (elapsedTimerRef.current)  clearInterval(elapsedTimerRef.current);
    };
  }, []);

  return { startRecording, stopRecording, cleanupLocalAudio };
}
