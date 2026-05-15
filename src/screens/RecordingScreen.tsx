import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../constants/theme';
import { useAudioRecording } from '../hooks/useAudioRecording';
import { useLocation } from '../hooks/useLocation';
import { useMeetingStore } from '../stores/meetingStore';
import { createMeetingRecord, updateMeetingRecord } from '../services/meetingService';
import { useAuth } from '../hooks/useAuth';
import { formatDuration } from '../utils/format';
import { nanoid } from '../utils/nanoid';
import dayjs from 'dayjs';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'Recording'>;

const IS_WEB = Platform.OS === 'web';

function PulsingDot() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const iv = setInterval(() => setVisible((v) => !v), 800);
    return () => clearInterval(iv);
  }, []);
  return <View style={[styles.pulseDot, { opacity: visible ? 1 : 0.15 }]} />;
}

export function RecordingScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { setupData } = route.params;
  const { user } = useAuth();

  const setSetupData    = useMeetingStore((s) => s.setSetupData);
  const setStartTime    = useMeetingStore((s) => s.setStartTime);
  const setEndTime      = useMeetingStore((s) => s.setEndTime);
  const setLocation     = useMeetingStore((s) => s.setLocation);
  const setCurrentMId   = useMeetingStore((s) => s.setCurrentMeetingId);
  const setElapsed      = useMeetingStore((s) => s.setRecordingElapsed);
  const setIsRecording  = useMeetingStore((s) => s.setIsRecording);
  const elapsed         = useMeetingStore((s) => s.recordingElapsedSeconds);
  const storeLatitude   = useMeetingStore((s) => s.latitude);
  const storeLongitude  = useMeetingStore((s) => s.longitude);
  const storeAddress    = useMeetingStore((s) => s.address);

  const { startRecording, stopRecording } = useAudioRecording();
  const { requestAndCapture } = useLocation();

  const [stopping, setStopping]             = useState(false);
  const [dbError, setDbError]               = useState('');
  const [locationStatus, setLocationStatus] = useState<'capturing' | 'captured' | 'failed'>('capturing');
  const [audioStatus, setAudioStatus]       = useState<'pending' | 'active' | 'denied'>('pending');

  // Refs so confirmStop always reads fresh values
  const meetingIdRef      = useRef<string>(nanoid()); // local fallback ID
  const dbSavedRef        = useRef(false);
  const webElapsedRef     = useRef(0);
  const webTimerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const webAudioActiveRef = useRef(false); // true when MediaRecorder is running
  const latRef            = useRef<number | null>(null);
  const lngRef            = useRef<number | null>(null);
  const addrRef           = useRef<string | null>(null);
  const startTimeRef      = useRef(new Date());

  // Keep location refs in sync
  useEffect(() => { latRef.current  = storeLatitude;  }, [storeLatitude]);
  useEffect(() => { lngRef.current  = storeLongitude; }, [storeLongitude]);
  useEffect(() => { addrRef.current = storeAddress;   }, [storeAddress]);

  useEffect(() => {
    setSetupData(setupData);
    startTimeRef.current = new Date();
    setStartTime(startTimeRef.current);

    if (IS_WEB) {
      startWebMode();
    } else {
      startMobileRecording();
    }

    // Create DB record in background (non-blocking)
    createDbRecord();

    // Capture location in background
    captureLocation();

    return () => stopWebTimer();
  }, []);

  // ── Web mode: try audio first, fall back to timer-only ────────
  const startWebMode = async () => {
    const audioStarted = await startRecording(); // startRecording now handles web via MediaRecorder
    if (audioStarted) {
      webAudioActiveRef.current = true;
      setAudioStatus('active');
    } else {
      // Mic permission denied — run timer-only
      setAudioStatus('denied');
      setIsRecording(true);
      startWebTimer();
    }
  };

  // ── Web timer (fallback when mic denied) ───────────────────
  const startWebTimer = () => {
    webElapsedRef.current = 0;
    webTimerRef.current = setInterval(() => {
      webElapsedRef.current += 1;
      setElapsed(webElapsedRef.current);
    }, 1000);
  };

  const stopWebTimer = () => {
    if (webTimerRef.current) {
      clearInterval(webTimerRef.current);
      webTimerRef.current = null;
    }
  };

  // ── Mobile recording ────────────────────────────────────────
  const startMobileRecording = async () => {
    const started = await startRecording();
    if (!started) {
      Alert.alert(
        'Microphone Permission Required',
        'Please allow microphone access to record your meeting.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    }
  };

  // ── Create DB record (best-effort) ──────────────────────────
  const createDbRecord = async () => {
    try {
      const userId = user?.id;
      if (!userId) return; // not logged in — session will handle navigation

      const record = {
        meeting_title:          setupData.meetingTitle,
        client_name:            setupData.clientName,
        attendees:              setupData.attendees,
        prepared_by:            setupData.preparedBy,
        start_time:             startTimeRef.current.toISOString(),
        end_time:               startTimeRef.current.toISOString(),
        duration_seconds:       0,
        meeting_date:           dayjs(startTimeRef.current).format('YYYY-MM-DD'),
        latitude:               null,
        longitude:              null,
        address:                null,
        transcript:             null,
        agenda:                 null,
        summary:                null,
        key_discussion_points:  null,
        decisions:              null,
        action_items:           null,
        next_steps:             null,
        pdf_url:                null,
        status:                 'recording' as const,
        created_by:             userId,
      };

      const id = await createMeetingRecord(record);
      meetingIdRef.current = id;
      setCurrentMId(id);
      dbSavedRef.current = true;
      setDbError('');
    } catch (e: any) {
      setDbError('⚠️  Could not save to database. Check Supabase setup.');
    }
  };

  // ── Location ────────────────────────────────────────────────
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

  // ── Stop ────────────────────────────────────────────────────
  const handleStop = () => {
    if (IS_WEB) {
      // eslint-disable-next-line no-alert
      const ok = window.confirm('Stop this meeting and generate minutes?');
      if (ok) doStop();
    } else {
      Alert.alert('Stop Meeting?', 'This will end the recording and prepare your meeting minutes.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Stop Meeting', style: 'destructive', onPress: doStop },
      ]);
    }
  };

  const doStop = useCallback(async () => {
    if (stopping) return;
    setStopping(true);

    const endTime = new Date();
    setEndTime(endTime);

    if (IS_WEB) {
      const mid = meetingIdRef.current;

      if (webAudioActiveRef.current) {
        await stopRecording(); // finalises audio blob, stops stream, stops elapsed timer
      } else {
        stopWebTimer();
        setIsRecording(false);
      }

      const dur = useMeetingStore.getState().durationSeconds || webElapsedRef.current;

      if (dbSavedRef.current) {
        try {
          await updateMeetingRecord(mid, {
            end_time:         endTime.toISOString(),
            duration_seconds: dur,
            latitude:         latRef.current,
            longitude:        lngRef.current,
            address:          addrRef.current,
          });
        } catch { /* continue */ }
      }

      navigation.replace('NextSteps', { meetingId: mid });
    } else {
      try {
        await stopRecording();
        navigation.replace('NextSteps', { meetingId: meetingIdRef.current });
      } catch {
        setStopping(false);
        Alert.alert('Error', 'Failed to stop recording. Please try again.');
      }
    }
  }, [stopping]);

  // ── Location display text ───────────────────────────────────
  const locationText = () => {
    if (locationStatus === 'capturing') return '📍  Capturing location...';
    if (locationStatus === 'captured')
      return storeAddress
        ? `📍  ${storeAddress}`
        : `📍  ${storeLatitude?.toFixed(5)}, ${storeLongitude?.toFixed(5)}`;
    return '📍  Location not available';
  };

  const isReady = IS_WEB || true; // on mobile, useAudioRecording controls its own state

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container}>

        {/* ── Status bar ── */}
        <View style={styles.statusBar}>
          <View style={styles.statusLeft}>
            {IS_WEB && <PulsingDot />}
            <Text style={styles.statusText}>
              {IS_WEB ? (stopping ? 'STOPPING...' : 'WEB PREVIEW') : (stopping ? 'STOPPING...' : 'RECORDING')}
            </Text>
          </View>
          <Text style={styles.timer}>{formatDuration(elapsed)}</Text>
        </View>

        {/* ── Web notice ── */}
        {IS_WEB && audioStatus === 'denied' && (
          <View style={styles.webBanner}>
            <Text style={styles.webBannerText}>
              🎙️  Microphone permission denied — meeting will be recorded without audio. Allow mic access and restart for full recording.
            </Text>
          </View>
        )}

        {/* ── DB error ── */}
        {dbError ? (
          <View style={styles.errorBar}>
            <Text style={styles.errorBarText}>{dbError}</Text>
          </View>
        ) : null}

        {/* ── Main content ── */}
        <View style={styles.content}>

          {/* Meeting card */}
          <View style={styles.meetingCard}>
            <Text style={styles.meetingLabel}>MEETING</Text>
            <Text style={styles.meetingTitle}>{setupData.meetingTitle}</Text>
            <Text style={styles.clientName}>{setupData.clientName}</Text>
          </View>

          {/* Mic visual */}
          <View style={styles.visual}>
            <View style={[styles.ring3, stopping && styles.dim]}>
              <View style={[styles.ring2, stopping && styles.dim]}>
                <View style={[styles.ring1, stopping && styles.dim]}>
                  <Text style={styles.micEmoji}>🎙️</Text>
                </View>
              </View>
            </View>
            <Text style={styles.visualHint}>
              {stopping
                ? 'Finalising...'
                : IS_WEB
                ? (audioStatus === 'active' ? '🎙️  Recording audio · Click Stop Meeting when done' : 'Timer running · Click Stop Meeting when done')
                : 'Place phone on table · Recording in progress'}
            </Text>
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

          {/* Attendees */}
          <View style={styles.infoChip}>
            <Text style={styles.infoChipLabel}>
              👥  {setupData.attendees.length} Attendee{setupData.attendees.length !== 1 ? 's' : ''}
            </Text>
            <Text style={styles.infoChipText} numberOfLines={1}>
              {setupData.attendees.map((a) => a.name).filter(Boolean).join(', ')}
            </Text>
          </View>

        </View>

        {/* ── Stop button ── */}
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
          <Text style={styles.footerHint}>Tap when the meeting ends to generate minutes</Text>
        </View>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: COLORS.primary },
  container: { flex: 1, flexDirection: 'column' },

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

  webBanner: {
    backgroundColor: 'rgba(232,160,32,0.15)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(232,160,32,0.3)',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xs + 2,
  },
  webBannerText: {
    fontSize: FONTS.sizes.sm, color: COLORS.accentLight, textAlign: 'center',
  },

  errorBar: {
    backgroundColor: 'rgba(220,38,38,0.15)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(220,38,38,0.3)',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xs + 2,
  },
  errorBarText: { fontSize: FONTS.sizes.sm, color: '#FCA5A5', textAlign: 'center' },

  content: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
  },

  meetingCard: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
  },
  meetingLabel: {
    fontSize: FONTS.sizes.xs, fontWeight: '700',
    color: 'rgba(255,255,255,0.55)', letterSpacing: 2, marginBottom: 4,
  },
  meetingTitle: { fontSize: FONTS.sizes.lg, fontWeight: '800', color: COLORS.white, textAlign: 'center' },
  clientName:   { fontSize: FONTS.sizes.base, color: 'rgba(255,255,255,0.7)', marginTop: 2 },

  visual:     { alignItems: 'center', gap: SPACING.sm },
  ring3: {
    width: 132, height: 132, borderRadius: 66,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center', justifyContent: 'center',
  },
  ring2: {
    width: 98, height: 98, borderRadius: 49,
    backgroundColor: 'rgba(255,255,255,0.11)',
    alignItems: 'center', justifyContent: 'center',
  },
  ring1: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.17)',
    alignItems: 'center', justifyContent: 'center',
  },
  dim:       { opacity: 0.3 },
  micEmoji:  { fontSize: 28 },
  visualHint: {
    fontSize: FONTS.sizes.sm, color: 'rgba(255,255,255,0.55)',
    textAlign: 'center', maxWidth: 280,
  },

  infoChip: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.md,
  },
  infoChipLabel: {
    fontSize: FONTS.sizes.xs, fontWeight: '600',
    color: 'rgba(255,255,255,0.55)', marginBottom: 2,
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
  stopBtnText: { fontSize: FONTS.sizes.md, fontWeight: '800', color: COLORS.recordingRed },
  footerHint:  { fontSize: FONTS.sizes.xs, color: 'rgba(255,255,255,0.35)', textAlign: 'center' },
});
