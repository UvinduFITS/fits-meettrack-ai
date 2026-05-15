import { useRef, useCallback, useEffect } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { useMeetingStore } from '../stores/meetingStore';
import { AudioChunk } from '../types';

const CHUNK_DURATION_MS = 10 * 60 * 1000; // 10 minutes

export function useAudioRecording() {
  // Shared
  const chunkIndexRef    = useRef(0);
  const elapsedTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedSecondsRef = useRef(0);
  const isStoppingRef    = useRef(false);

  // Mobile (expo-av)
  const recordingRef   = useRef<Audio.Recording | null>(null);
  const chunkTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Web (MediaRecorder)
  const webRecorderRef    = useRef<MediaRecorder | null>(null);
  const webStreamRef      = useRef<MediaStream | null>(null);
  const webChunkDataRef   = useRef<Blob[]>([]);
  const webChunkTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addAudioChunk      = useMeetingStore((s) => s.addAudioChunk);
  const setRecordingElapsed = useMeetingStore((s) => s.setRecordingElapsed);
  const setIsRecording     = useMeetingStore((s) => s.setIsRecording);

  // ── Web helpers ──────────────────────────────────────────────────────────────

  const finalizeWebChunk = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      const recorder = webRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') { resolve(); return; }

      recorder.addEventListener('stop', () => {
        const blob = new Blob(webChunkDataRef.current, { type: recorder.mimeType || 'audio/webm' });
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

      recorder.stop();
    });
  }, [addAudioChunk]);

  const startWebChunk = useCallback(async () => {
    if (isStoppingRef.current || !webStreamRef.current) return;

    const recorder = new MediaRecorder(webStreamRef.current);
    webChunkDataRef.current = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) webChunkDataRef.current.push(e.data); };
    recorder.start(1000);
    webRecorderRef.current = recorder;

    webChunkTimerRef.current = setTimeout(async () => {
      if (isStoppingRef.current) return;
      await finalizeWebChunk();
      await startWebChunk();
    }, CHUNK_DURATION_MS);
  }, [finalizeWebChunk]);

  // ── Mobile helpers ────────────────────────────────────────────────────────────

  const stopCurrentRecordingChunk = useCallback(async (): Promise<string | null> => {
    if (!recordingRef.current) return null;
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      return uri ?? null;
    } catch { return null; }
  }, []);

  const startNewChunk = useCallback(async () => {
    if (isStoppingRef.current) return;
    const recording = new Audio.Recording();
    await recording.prepareToRecordAsync({
      android: {
        extension: '.m4a',
        outputFormat: Audio.AndroidOutputFormat.MPEG_4,
        audioEncoder: Audio.AndroidAudioEncoder.AAC,
        sampleRate: 16000,
        numberOfChannels: 1,
        bitRate: 64000,
      },
      ios: {
        extension: '.m4a',
        outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
        audioQuality: Audio.IOSAudioQuality.MEDIUM,
        sampleRate: 16000,
        numberOfChannels: 1,
        bitRate: 64000,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
      },
      web: {},
    });
    await recording.startAsync();
    recordingRef.current = recording;

    chunkTimerRef.current = setTimeout(async () => {
      if (isStoppingRef.current) return;
      const uri = await stopCurrentRecordingChunk();
      if (uri) {
        addAudioChunk({ index: chunkIndexRef.current, localPath: uri, storagePath: null, processed: false });
        chunkIndexRef.current += 1;
      }
      await startNewChunk();
    }, CHUNK_DURATION_MS);
  }, [stopCurrentRecordingChunk, addAudioChunk]);

  // ── Public API ────────────────────────────────────────────────────────────────

  const startRecording = useCallback(async (): Promise<boolean> => {
    try {
      isStoppingRef.current = false;
      chunkIndexRef.current = 0;
      elapsedSecondsRef.current = 0;

      if (Platform.OS === 'web') {
        const stream = await (navigator.mediaDevices as any).getUserMedia({ audio: true });
        webStreamRef.current = stream as MediaStream;
        await startWebChunk();
      } else {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== 'granted') return false;
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
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
      try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch { /* ignore */ }
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
      if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current);
      if (webChunkTimerRef.current) clearTimeout(webChunkTimerRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  return { startRecording, stopRecording, cleanupLocalAudio };
}
