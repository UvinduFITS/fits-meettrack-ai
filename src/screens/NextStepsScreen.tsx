import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../constants/theme';
import { useMeetingStore } from '../stores/meetingStore';
import { uploadAudioChunk, updateMeetingRecord, createMeetingRecord, getMeetingById } from '../services/meetingService';
import { useAuth } from '../hooks/useAuth';
import { formatDurationHuman } from '../utils/format';
import dayjs from 'dayjs';

async function tryReverseGeocode(lat: number, lng: number): Promise<string | null> {
  // Primary: Nominatim — returns street-level detail and POI names
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=en&addressdetails=1`
    );
    if (res.ok) {
      const json = await res.json();
      const a = json.address ?? {};
      const streetNum = [a.house_number, a.road || a.pedestrian || a.footway].filter(Boolean).join(' ');
      const parts = [
        a.amenity || a.building || a.office || a.shop || a.tourism,
        streetNum || undefined,
        a.suburb || a.neighbourhood || a.quarter,
        a.city || a.town || a.village || a.county,
        a.postcode,
        a.country,
      ].filter(Boolean) as string[];
      if (parts.length >= 2) return parts.join(', ');
    }
  } catch { /* fall through */ }

  // Fallback: BigDataCloud
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
    );
    if (res.ok) {
      const json = await res.json();
      const parts = [json.locality || json.city, json.principalSubdivision, json.countryName].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : null;
    }
  } catch { /* ignore */ }

  return null;
}

type Nav   = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'NextSteps'>;

const IS_WEB = Platform.OS === 'web';

const SUGGESTIONS = [
  'Schedule follow-up call',
  'Send proposal',
  'Review contract',
  'Provide samples',
  'Share pricing',
];

export function NextStepsScreen() {
  const navigation    = useNavigation<Nav>();
  const route         = useRoute<Route>();
  const { meetingId } = route.params;
  const { user }      = useAuth();

  const setupData              = useMeetingStore((s) => s.setupData);
  const startTime              = useMeetingStore((s) => s.startTime);
  const endTime                = useMeetingStore((s) => s.endTime);
  const storedDuration         = useMeetingStore((s) => s.durationSeconds);
  const recordingElapsed       = useMeetingStore((s) => s.recordingElapsedSeconds);
  // Priority: store durationSeconds > elapsed timer > timestamp diff
  const durationSeconds = storedDuration > 0
    ? storedDuration
    : recordingElapsed > 0
      ? recordingElapsed
      : (startTime && endTime ? Math.max(1, Math.floor((endTime.getTime() - startTime.getTime()) / 1000)) : 0);
  const address                = useMeetingStore((s) => s.address);
  const latitude               = useMeetingStore((s) => s.latitude);
  const longitude              = useMeetingStore((s) => s.longitude);
  const audioChunks            = useMeetingStore((s) => s.audioChunks);
  const setNextSteps           = useMeetingStore((s) => s.setNextSteps);
  const setChunkStoragePath    = useMeetingStore((s) => s.setChunkStoragePath);
  const nextSteps              = useMeetingStore((s) => s.nextSteps);

  const [inputText,    setInputText]    = useState(nextSteps);
  const [locationText, setLocationText] = useState(address ?? '');
  const [geocoding,    setGeocoding]    = useState(false);
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState('');

  // Geocode on mount if address wasn't captured during recording
  useEffect(() => {
    if (!address && latitude != null && longitude != null) {
      setGeocoding(true);
      tryReverseGeocode(latitude, longitude).then((result) => {
        if (result) setLocationText(result);
        setGeocoding(false);
      });
    }
  }, []);

  const appendSuggestion = (s: string) =>
    setInputText((prev) => prev.trim() ? `${prev.trim()}\n• ${s}` : `• ${s}`);

  const handleGenerate = async () => {
    setError('');

    if (!inputText.trim()) {
      setError('Please enter at least one next step before generating minutes.');
      return;
    }

    setSubmitting(true);
    setNextSteps(inputText.trim());

    const now = new Date();
    let finalMeetingId = meetingId;
    const finalAddress = locationText.trim() || null;

    try {
      const existing = await getMeetingById(meetingId);

      if (existing) {
        // Record exists — just update it
        await updateMeetingRecord(meetingId, {
          end_time:         (endTime ?? now).toISOString(),
          duration_seconds: durationSeconds,
          latitude,
          longitude,
          address:          finalAddress,
          next_steps:       inputText.trim(),
          status:           'processing',
        });
      } else {
        // RecordingScreen's DB call failed silently — create the record now
        finalMeetingId = await createMeetingRecord({
          meeting_title:        setupData?.meetingTitle ?? 'Meeting',
          client_name:          setupData?.clientName   ?? 'Unknown',
          attendees:            setupData?.attendees    ?? [],
          prepared_by:          setupData?.preparedBy   ?? '',
          start_time:           (startTime ?? now).toISOString(),
          end_time:             (endTime   ?? now).toISOString(),
          duration_seconds:     durationSeconds,
          meeting_date:         dayjs(startTime ?? now).format('YYYY-MM-DD'),
          latitude,
          longitude,
          address:              finalAddress,
          transcript:           null,
          agenda:               null,
          summary:              null,
          key_discussion_points: null,
          decisions:            null,
          action_items:         null,
          next_steps:           inputText.trim(),
          pdf_url:              null,
          status:               'processing',
          created_by:           user?.id ?? '',
        });
      }
    } catch (dbErr: any) {
      // If DB is completely unreachable, show an error and stop
      setSubmitting(false);
      setError(`Could not save meeting to database: ${dbErr?.message ?? 'Unknown error'}. Please check your connection and try again.`);
      return;
    }

    // Upload audio chunks (web + mobile) and save actual storage path
    for (const chunk of audioChunks) {
      try {
        const path = await uploadAudioChunk(chunk, finalMeetingId);
        setChunkStoragePath(chunk.index, path);
      } catch { /* continue */ }
    }

    navigation.replace('Processing', { meetingId: finalMeetingId });
  };

  const duration = durationSeconds > 0 ? formatDurationHuman(durationSeconds) : '—';

  const summaryRows: [string, string][] = [
    ['Meeting',  setupData?.meetingTitle ?? '—'],
    ['Client',   setupData?.clientName  ?? '—'],
    ['Date',     startTime ? dayjs(startTime).format('DD MMM YYYY') : '—'],
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Meeting Complete</Text>
          <Text style={styles.headerSub}>Duration: {duration}</Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Summary card */}
          <View style={styles.summaryCard}>
            {summaryRows.map(([label, value], i) => (
              <View key={label}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>{label}</Text>
                  <Text style={styles.summaryValue} numberOfLines={2}>{value}</Text>
                </View>
                {i < summaryRows.length - 1 && <View style={styles.divider} />}
              </View>
            ))}
          </View>

          {/* Editable location */}
          <View style={styles.locationCard}>
            <View style={styles.locationHeader}>
              <Text style={styles.locationLabel}>📍 Meeting Location</Text>
              {geocoding && <Text style={styles.locationHint}>Detecting…</Text>}
            </View>
            <TextInput
              style={styles.locationInput}
              value={locationText}
              onChangeText={setLocationText}
              placeholder="e.g. Sofia Colombo City Hotel, Galle Road, Colombo"
              placeholderTextColor={COLORS.textMuted}
              multiline
              textAlignVertical="top"
            />
            {(latitude != null && longitude != null) && (
              <TouchableOpacity
                onPress={async () => {
                  setGeocoding(true);
                  const result = await tryReverseGeocode(latitude!, longitude!);
                  if (result) setLocationText(result);
                  setGeocoding(false);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.locationRefresh}>↺ Retry auto-detect</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.sectionTitle}>Next Steps & Follow-up</Text>
          <Text style={styles.sectionSub}>
            What are the agreed next steps from this meeting? These will appear in your meeting minutes.
          </Text>

          {!!error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>⚠️  {error}</Text>
            </View>
          )}

          <View style={styles.inputCard}>
            <TextInput
              style={styles.textArea}
              value={inputText}
              onChangeText={(t) => { setInputText(t); setError(''); }}
              placeholder={'• Send proposal by Friday\n• Schedule technical demo\n• Review pricing options'}
              placeholderTextColor={COLORS.textMuted}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />
          </View>

          <Text style={styles.quickLabel}>QUICK ADD:</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
          >
            {SUGGESTIONS.map((s) => (
              <TouchableOpacity key={s} style={styles.chip} onPress={() => appendSuggestion(s)} activeOpacity={0.7}>
                <Text style={styles.chipText}>+ {s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.infoBanner}>
            <Text style={styles.infoIcon}>✨</Text>
            <Text style={styles.infoText}>
              Our AI will analyse the meeting, identify key discussion points, decisions, and action items — then generate a professional PDF.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.generateBtn, submitting && styles.generateBtnDisabled]}
            onPress={handleGenerate}
            activeOpacity={0.85}
            disabled={submitting}
          >
            <Text style={styles.generateBtnText}>
              {submitting ? 'Preparing...' : 'Generate Meeting Minutes'}
            </Text>
          </TouchableOpacity>

          {IS_WEB && (
            <Text style={styles.webNote}>
              ℹ️  The Supabase Edge Function must be deployed for AI processing to work. See README for setup steps.
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.background },
  header: {
    backgroundColor: COLORS.surface, paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md, borderBottomWidth: 1,
    borderBottomColor: COLORS.border, alignItems: 'center',
  },
  headerTitle: { fontSize: FONTS.sizes.lg, fontWeight: '800', color: COLORS.text },
  headerSub:   { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 2 },
  scroll:        { flex: 1 },
  scrollContent: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  summaryCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md,
    marginBottom: SPACING.lg, borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.sm,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: SPACING.xs + 2 },
  summaryLabel: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, fontWeight: '600', width: 70 },
  summaryValue: { fontSize: FONTS.sizes.sm, color: COLORS.text, fontWeight: '500', flex: 1, textAlign: 'right' },
  divider: { height: 1, backgroundColor: COLORS.divider },
  locationCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1,
    borderColor: COLORS.border, padding: SPACING.md, marginBottom: SPACING.lg, ...SHADOWS.sm,
  },
  locationHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.xs },
  locationLabel:  { fontSize: FONTS.sizes.sm, fontWeight: '700', color: COLORS.text },
  locationHint:   { fontSize: FONTS.sizes.xs, color: COLORS.textMuted },
  locationInput: {
    fontSize: FONTS.sizes.sm, color: COLORS.text, minHeight: 44,
    paddingVertical: SPACING.xs, textAlignVertical: 'top',
  },
  locationRefresh: { fontSize: FONTS.sizes.xs, color: COLORS.primary, fontWeight: '600', marginTop: SPACING.xs },
  sectionTitle: { fontSize: FONTS.sizes.md, fontWeight: '700', color: COLORS.text, marginBottom: 4 },
  sectionSub:   { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginBottom: SPACING.md, lineHeight: 20 },
  errorBanner: {
    backgroundColor: '#FEF2F2', borderRadius: RADIUS.md, borderWidth: 1,
    borderColor: '#FECACA', padding: SPACING.md, marginBottom: SPACING.md,
  },
  errorText: { fontSize: FONTS.sizes.sm, color: COLORS.error, lineHeight: 20 },
  inputCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1,
    borderColor: COLORS.border, marginBottom: SPACING.md, overflow: 'hidden', ...SHADOWS.sm,
  },
  textArea: { padding: SPACING.md, fontSize: FONTS.sizes.base, color: COLORS.text, minHeight: 140, textAlignVertical: 'top' },
  quickLabel: { fontSize: FONTS.sizes.xs, fontWeight: '700', color: COLORS.textMuted, marginBottom: SPACING.sm, letterSpacing: 0.5 },
  chipsRow: { gap: SPACING.sm, paddingRight: SPACING.md, marginBottom: SPACING.lg },
  chip: { backgroundColor: COLORS.surfaceSecondary, borderRadius: RADIUS.full, paddingVertical: SPACING.xs + 2, paddingHorizontal: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  chipText: { fontSize: FONTS.sizes.sm, color: COLORS.primary, fontWeight: '600' },
  infoBanner: {
    flexDirection: 'row', backgroundColor: '#EEF4FF', borderRadius: RADIUS.md,
    padding: SPACING.md, marginBottom: SPACING.lg, borderWidth: 1, borderColor: '#C7D9FF',
    gap: SPACING.sm, alignItems: 'flex-start',
  },
  infoIcon: { fontSize: 16, marginTop: 1 },
  infoText: { flex: 1, fontSize: FONTS.sizes.sm, color: COLORS.primary, lineHeight: 20 },
  generateBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.xl, paddingVertical: SPACING.md + 4, alignItems: 'center', ...SHADOWS.md, marginBottom: SPACING.md },
  generateBtnDisabled: { opacity: 0.55 },
  generateBtnText: { fontSize: FONTS.sizes.md, fontWeight: '800', color: COLORS.white, letterSpacing: 0.3 },
  webNote: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, textAlign: 'center', lineHeight: 18, paddingHorizontal: SPACING.md },
});
