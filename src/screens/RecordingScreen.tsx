import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../constants/theme';
import { useSpeechToText } from '../hooks/useSpeechToText';
import { useLocation } from '../hooks/useLocation';
import { useMeetingStore } from '../stores/meetingStore';
import { createMeetingRecord, updateMeetingRecord } from '../services/meetingService';
import { useAuth } from '../hooks/useAuth';
import { formatDuration } from '../utils/format';
import { nanoid } from '../utils/nanoid';
import dayjs from 'dayjs';

type Nav   = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'Recording'>;

const IS_WEB = Platform.OS === 'web';

function PulsingDot({ active }: { active: boolean }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setVisible((v) => !v), 700);
    return () => clearInterval(iv);
  }, [active]);
  return (
    <View style={[styles.pulseDot, { opacity: active ? (visible ? 1 : 0.2) : 0.2 }]} />
  );
}

export function RecordingScreen() {
  const navigation = useNavigation<Nav>();
  const route      = useRoute<Route>();
  const { setupData } = route.params;
  const { user } = useAuth();

  const setSetupData      = useMeetingStore((s) => s.setSetupData);
  const setStartTime      = useMeetingStore((s) => s.setStartTime);
  const setEndTime        = useMeetingStore((s) => s.setEndTime);
  const setLocation       = useMeetingStore((s) => s.setLocation);
  const setCurrentMId     = useMeetingStore((s) => s.setCurrentMeetingId);
  const setElapsed        = useMeetingStore((s) => s.setRecordingElapsed);
  const setIsRecording    = useMeetingStore((s) => s.setIsRecording);
  const setLiveTranscript = useMeetingStore((s) => s.setLiveTranscript);
  const elapsed           = useMeetingStore((s) => s.recordingElapsedSeconds);
  const storeLatitude     = useMeetingStore((s) => s.latitude);
  const storeLongitude    = useMeetingStore((s) => s.longitude);
  const storeAddress      = useMeetingStore((s) => s.address);

  const {
    transcript,
    partialTranscript,
    isListening,
    error: sttError,
    startListening,
    stopListening,
  } = useSpeechToText();

  const { requestAndCapture } = useLocation();

  const [stopping, setStopping]             = useState(false);
  const [dbError, setDbError]               = useState('');
  const [locationStatus, setLocationStatus] = useState<'capturing' | 'captured' | 'failed'>('capturing');

  const meetingIdRef  = useRef<string>(nanoid());
  const dbSavedRef    = useRef(false);
  const elapsedRef    = useRef(0);
  const elapsedTimer  = useRef<ReturnType<typeof setInterval> | null>(null);
  const latRef        = useRef<number | null>(null);
  const lngRef        = useRef<number | null>(null);
  const addrRef       = useRef<string | null>(null);
  const startTimeRef  = useRef(new Date());
  const transcriptScrollRef = useRef<ScrollView>(null);

  // Keep location refs in sync with store
  useEffect(() => { latRef.current  = storeLatitude;  }, [storeLatitude]);
  useEffect(() => { lngRef.current  = storeLongitude; }, [storeLongitude]);
  useEffect(() => { addrRef.current = storeAddress;   }, [storeAddress]);

  // Auto-scroll transcript to bottom as text grows
  useEffect(() => {
    transcriptScrollRef.current?.scrollToEnd({ animated: true });
  }, [transcript, partialTranscript]);

  useEffect(() => {
    setSetupData(setupData);
    startTimeRef.current = new Date();
    setStartTime(startTimeRef.current);

    // Start elapsed timer
    elapsedRef.current = 0;
    elapsedTimer.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
    }, 1000);

    setIsRecording(true);

    // Start STT (web will show an error message inline)
    startListening();

    // DB and location run in background (non-blocking)
    createDbRecord();
    captureLocation();

    return () => {
      if (elapsedTimer.current) clearInterval(elapsedTimer.current);
    };
  }, []);

  // ── DB record ────────────────────────────────────────────────────────────────
  const createDbRecord = async () => {
    try {
      if (!user?.id) return;
      const id = await createMeetingRecord({
        meeting_title:         setupData.meetingTitle,
        client_name:           setupData.clientName,
        attendees:             setupData.attendees,
        prepared_by:           setupData.preparedBy,
        start_time:            startTimeRef.current.toISOString(),
        end_time:              startTimeRef.current.toISOString(),
        duration_seconds:      0,
        meeting_date:          dayjs(startTimeRef.current).format('YYYY-MM-DD'),
        latitude:              null,
        longitude:             null,
        address:               null,
        transcript:            null,
        agenda:                null,
        summary:               null,
        key_discussion_points: null,
        decisions:             null,
        action_items:          null,
        next_steps:            null,
        pdf_url:               null,
        status:                'recording' as const,
        created_by:            user.id,
      });
      meetingIdRef.current = id;
      setCurrentMId(id);
      dbSavedRef.current = true;
    } catch {
      setDbError('⚠️  Could not save to database. Check your connection.');
    }
  };

  // ── Location ─────────────────────────────────────────────────────────────────
  const captureLocation = async () => {
    setLocationStatus('capturing');
    const loc = await requestAndCapture();
    if (loc) {
      setLocation(loc.latitude, loc.longitude, loc.address);
      setLocationStatus('captured');
    } else {
      setLocationStatus('failed');
    }
  };

  // ── Stop ──────────────────────────────────────────────────────────────────────
  const handleStop = () => {
    if (IS_WEB) {
      const ok = window.confirm('Stop this meeting and generate minutes?');
      if (ok) doStop();
    } else {
      Alert.alert(
        'Stop Meeting?',
        'This will end the recording and prepare your meeting minutes.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Stop Meeting', style: 'destructive', onPress: doStop },
        ]
      );
    }
  };

  const doStop = useCallback(async () => {
    if (stopping) return;
    setStopping(true);

    const endTime = new Date();
    setEndTime(endTime);

    // Stop elapsed timer
    if (elapsedTimer.current) {
      clearInterval(elapsedTimer.current);
      elapsedTimer.current = null;
    }

    // Stop STT and snapshot the transcript
    stopListening();
    const finalTranscript = transcript.trim();
    setLiveTranscript(finalTranscript);
    setIsRecording(false);

    const dur = elapsedRef.current;

    // Update DB record with final duration + location
    if (dbSavedRef.current) {
      try {
        await updateMeetingRecord(meetingIdRef.current, {
          end_time:         endTime.toISOString(),
          duration_seconds: dur,
          latitude:         latRef.current,
          longitude:        lngRef.current,
          address:          addrRef.current,
        });
      } catch { /* non-blocking — NextStepsScreen will handle */ }
    }

    navigation.replace('NextSteps', { meetingId: meetingIdRef.current });
  }, [stopping, transcript, stopListening, setLiveTranscript]);

  // ── Location display ──────────────────────────────────────────────────────────
  const locationText = () => {
    if (locationStatus === 'capturing') return '📍  Capturing location...';
    if (locationStatus === 'captured')
      return storeAddress
        ? `📍  ${storeAddress}`
        : `📍  ${storeLatitude?.toFixed(5)}, ${storeLongitude?.toFixed(5)}`;
    return '📍  Location not available';
  };

  const hasTranscript = transcript.length > 0 || partialTranscript.length > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container}>

        {/* ── Status bar ── */}
        <View style={styles.statusBar}>
          <View style={styles.statusLeft}>
            <PulsingDot active={isListening && !stopping} />
            <Text style={styles.statusText}>
              {stopping
                ? 'STOPPING...'
                : IS_WEB
                  ? 'WEB PREVIEW'
                  : isListening
                    ? 'LISTENING'
                    : 'STARTING...'}
            </Text>
          </View>
          <Text style={styles.timer}>{formatDuration(elapsed)}</Text>
        </View>

        {/* ── DB error ── */}
        {!!dbError && (
          <View style={styles.errorBar}>
            <Text style={styles.errorBarText}>{dbError}</Text>
          </View>
        )}

        {/* ── Web not-supported notice ── */}
        {IS_WEB && (
          <View style={styles.warningBar}>
            <Text style={styles.warningBarText}>
              🎙️  Speech recognition is not available in the web preview. Use the Android app for live transcription.
            </Text>
          </View>
        )}

        {/* ── STT permission / error notice ── */}
        {!IS_WEB && sttError && !stopping && (
          <View style={styles.warningBar}>
            <Text style={styles.warningBarText}>⚠️  {sttError}</Text>
          </View>
        )}

        {/* ── Main content ── */}
        <View style={styles.content}>

          {/* Meeting card */}
          <View style={styles.meetingCard}>
            <Text style={styles.meetingLabel}>MEETING</Text>
            <Text style={styles.meetingTitle} numberOfLines={2}>{setupData.meetingTitle}</Text>
            <Text style={styles.clientName}>{setupData.clientName}</Text>
          </View>

          {/* STT status pill */}
          {!IS_WEB && (
            <View style={[styles.sttStatus, isListening && styles.sttStatusActive]}>
              <Text style={styles.sttStatusEmoji}>{isListening ? '🎙️' : '⏸️'}</Text>
              <Text style={styles.sttStatusText}>
                {stopping
                  ? 'Finalising transcript...'
                  : isListening
                    ? 'Listening — speak clearly'
                    : 'Paused — will resume automatically'}
              </Text>
            </View>
          )}

          {/* Live transcript box */}
          <View style={styles.transcriptBox}>
            <View style={styles.transcriptHeader}>
              <Text style={styles.transcriptLabel}>LIVE TRANSCRIPT</Text>
              {hasTranscript && (
                <Text style={styles.transcriptWordCount}>
                  {transcript.split(/\s+/).filter(Boolean).length} words
                </Text>
              )}
            </View>
            <ScrollView
              ref={transcriptScrollRef}
              style={styles.transcriptScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="never"
            >
              {!hasTranscript ? (
                <Text style={styles.transcriptPlaceholder}>
                  {IS_WEB
                    ? 'Speech recognition not available in web preview.'
                    : 'Start speaking — your words will appear here in real-time...'}
                </Text>
              ) : (
                <Text style={styles.transcriptText}>
                  {transcript}
                  {partialTranscript ? (
                    <Text style={styles.partialText}>{transcript ? ' ' : ''}{partialTranscript}</Text>
                  ) : null}
                </Text>
              )}
            </ScrollView>
          </View>

          {/* Location */}
          <View style={styles.infoChip}>
            <Text
              style={[styles.infoChipText, locationStatus === 'failed' && styles.textWarn]}
              numberOfLines={2}
            >
              {locationText()}
            </Text>
          </View>

        </View>

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.stopBtn, stopping && styles.stopBtnDisabled]}
            onPress={handleStop}
            activeOpacity={0.85}
            disabled={stopping}
          >
            {stopping ? (
              <Text style={styles.stopBtnText}>Stopping...</Text>
            ) : (
              <>
                <View style={styles.stopSquare} />
                <Text style={styles.stopBtnText}>Stop Meeting</Text>
              </>
            )}
          </TouchableOpacity>
          <Text style={styles.footerHint}>
            {IS_WEB
              ? 'Tap when the meeting ends'
              : 'Speak naturally · tap Stop when the meeting ends'}
          </Text>
        </View>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: COLORS.primary },
  container: { flex: 1 },

  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  pulseDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: COLORS.recordingRed,
  },
  statusText: {
    fontSize: FONTS.sizes.sm, fontWeight: '700',
    color: 'rgba(255,255,255,0.9)', letterSpacing: 2,
  },
  timer: {
    fontSize: FONTS.sizes.xl, fontWeight: '800',
    color: COLORS.white, letterSpacing: -0.5,
  },

  errorBar: {
    backgroundColor: 'rgba(220,38,38,0.15)',
    borderBottomWidth: 1, borderBottomColor: 'rgba(220,38,38,0.3)',
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.xs + 2,
  },
  errorBarText: { fontSize: FONTS.sizes.sm, color: '#FCA5A5', textAlign: 'center' },

  warningBar: {
    backgroundColor: 'rgba(232,160,32,0.15)',
    borderBottomWidth: 1, borderBottomColor: 'rgba(232,160,32,0.3)',
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.xs + 2,
  },
  warningBarText: {
    fontSize: FONTS.sizes.sm, color: COLORS.accentLight, textAlign: 'center', lineHeight: 18,
  },

  content: {
    flex: 1,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    gap: SPACING.sm,
  },

  meetingCard: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
  },
  meetingLabel: {
    fontSize: FONTS.sizes.xs, fontWeight: '700',
    color: 'rgba(255,255,255,0.55)', letterSpacing: 2, marginBottom: 2,
  },
  meetingTitle: {
    fontSize: FONTS.sizes.md, fontWeight: '800',
    color: COLORS.white, textAlign: 'center',
  },
  clientName: { fontSize: FONTS.sizes.sm, color: 'rgba(255,255,255,0.7)', marginTop: 2 },

  sttStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: RADIUS.full,
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.md,
    alignSelf: 'center',
  },
  sttStatusActive: { backgroundColor: 'rgba(52,211,153,0.15)' },
  sttStatusEmoji:  { fontSize: 14 },
  sttStatusText:   { fontSize: FONTS.sizes.xs, color: 'rgba(255,255,255,0.75)', fontWeight: '600' },

  transcriptBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  transcriptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 2,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  transcriptLabel: {
    fontSize: FONTS.sizes.xs, fontWeight: '700',
    color: 'rgba(255,255,255,0.5)', letterSpacing: 1,
  },
  transcriptWordCount: {
    fontSize: FONTS.sizes.xs, color: 'rgba(255,255,255,0.4)',
  },
  transcriptScroll: { flex: 1, padding: SPACING.md },
  transcriptPlaceholder: {
    fontSize: FONTS.sizes.sm,
    color: 'rgba(255,255,255,0.3)',
    fontStyle: 'italic',
    lineHeight: 22,
  },
  transcriptText: {
    fontSize: FONTS.sizes.sm,
    color: 'rgba(255,255,255,0.9)',
    lineHeight: 22,
  },
  partialText: {
    color: 'rgba(255,255,255,0.45)',
    fontStyle: 'italic',
  },

  infoChip: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  infoChipText: { fontSize: FONTS.sizes.sm, color: 'rgba(255,255,255,0.85)' },
  textWarn:     { color: 'rgba(255,160,100,0.9)' },

  footer: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xl,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.full,
    paddingVertical: SPACING.md + 4,
    paddingHorizontal: SPACING.xl,
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
    width: '100%',
    maxWidth: 340,
    ...SHADOWS.lg,
  },
  stopBtnDisabled: { opacity: 0.5 },
  stopSquare: {
    width: 16, height: 16, borderRadius: 3,
    backgroundColor: COLORS.recordingRed,
  },
  stopBtnText:  { fontSize: FONTS.sizes.md, fontWeight: '800', color: COLORS.recordingRed },
  footerHint:   { fontSize: FONTS.sizes.xs, color: 'rgba(255,255,255,0.35)', textAlign: 'center' },
});
