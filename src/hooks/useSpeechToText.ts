import { useRef, useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

const RESTART_DELAY_MS = 400;
const STT_LANG = 'en-US';

export interface SpeechToTextResult {
  transcript: string;
  partialTranscript: string;
  isListening: boolean;
  error: string | null;
  startListening: () => Promise<void>;
  stopListening: () => void;
  clearTranscript: () => void;
  resetTranscript: () => void;
}

export function useSpeechToText(): SpeechToTextResult {
  const [transcript, setTranscript]               = useState('');
  const [partialTranscript, setPartialTranscript] = useState('');
  const [isListening, setIsListening]             = useState(false);
  const [error, setError]                         = useState<string | null>(null);

  const transcriptRef   = useRef('');
  const isActiveRef     = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRestartTimer = () => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  const startSession = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.start({
        lang: STT_LANG,
        interimResults: true,
        maxAlternatives: 1,
        continuous: false, // Android doesn't support continuous; we auto-restart on 'end'
      });
    } catch { /* ignore duplicate-start errors */ }
  }, []);

  // ── Voice.onSpeechStart equivalent ──────────────────────────────────────────
  useSpeechRecognitionEvent('start', () => {
    setIsListening(true);
    setError(null);
  });

  // ── Voice.onSpeechEnd equivalent ─────────────────────────────────────────────
  useSpeechRecognitionEvent('end', () => {
    if (isActiveRef.current) {
      // Meeting is still in progress — restart recognition after a brief pause
      clearRestartTimer();
      restartTimerRef.current = setTimeout(() => {
        if (isActiveRef.current) startSession();
      }, RESTART_DELAY_MS);
    } else {
      setIsListening(false);
    }
  });

  // ── Voice.onSpeechResults + onSpeechPartialResults equivalent ────────────────
  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results?.[0]?.transcript ?? '';
    if (!text) return;

    if (event.isFinal) {
      // Append finalized phrase to the running transcript
      transcriptRef.current = transcriptRef.current.trim()
        ? `${transcriptRef.current.trim()} ${text.trim()}`
        : text.trim();
      setTranscript(transcriptRef.current);
      setPartialTranscript('');
    } else {
      // Show in-progress recognition as dimmed partial text
      setPartialTranscript(text);
    }
  });

  // ── Voice.onSpeechError equivalent ───────────────────────────────────────────
  useSpeechRecognitionEvent('error', (event) => {
    const code = event.error ?? 'unknown';

    // 'no-speech' and 'aborted' happen during the normal auto-restart cycle —
    // not real errors, just restart the session.
    if (isActiveRef.current && (code === 'no-speech' || code === 'aborted')) {
      clearRestartTimer();
      restartTimerRef.current = setTimeout(() => {
        if (isActiveRef.current) startSession();
      }, RESTART_DELAY_MS);
      return;
    }

    if (!isActiveRef.current) return;

    setError(`Speech recognition error: ${code}. Tap the mic to retry.`);
    setIsListening(false);
  });

  // ── startListening ────────────────────────────────────────────────────────────
  const startListening = useCallback(async () => {
    if (Platform.OS === 'web') {
      setError('Speech recognition is not available in the web preview. Use the Android/iOS app.');
      return;
    }

    setError(null);

    const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted) {
      setError('Microphone permission denied. Please allow access in your device Settings.');
      return;
    }

    isActiveRef.current = true;
    transcriptRef.current = '';
    setTranscript('');
    setPartialTranscript('');
    startSession();
  }, [startSession]);

  // ── stopListening ─────────────────────────────────────────────────────────────
  const stopListening = useCallback(() => {
    isActiveRef.current = false;
    clearRestartTimer();
    setPartialTranscript('');
    setIsListening(false);
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch { /* ignore if already stopped */ }
  }, []);

  // ── clearTranscript / resetTranscript ─────────────────────────────────────────
  const clearTranscript = useCallback(() => {
    transcriptRef.current = '';
    setTranscript('');
    setPartialTranscript('');
  }, []);

  const resetTranscript = clearTranscript;

  // ── Cleanup on unmount ────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      isActiveRef.current = false;
      clearRestartTimer();
      try { ExpoSpeechRecognitionModule.abort(); } catch { /* ignore */ }
    };
  }, []);

  return {
    transcript,
    partialTranscript,
    isListening,
    error,
    startListening,
    stopListening,
    clearTranscript,
    resetTranscript,
  };
}
