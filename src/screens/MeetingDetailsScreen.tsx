import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { RootStackParamList, MeetingRecord } from '../types';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../constants/theme';
import { getMeetingById } from '../services/meetingService';
import dayjs from 'dayjs';

const IS_WEB = Platform.OS === 'web';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'MeetingDetails'>;

export function MeetingDetailsScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { meetingId } = route.params;
  const [meeting, setMeeting] = useState<MeetingRecord | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [shareError, setShareError] = useState('');

  useEffect(() => {
    getMeetingById(meetingId).then(setMeeting);
  }, [meetingId]);

  const handleSharePdf = async () => {
    if (!meeting?.pdf_url) return;
    setShareError('');

    if (IS_WEB) {
      window.open(meeting.pdf_url, '_blank');
      return;
    }

    try {
      setDownloading(true);
      const localUri = FileSystem.cacheDirectory + `meeting_${meetingId}.pdf`;
      const dl = await FileSystem.downloadAsync(meeting.pdf_url, localUri);
      if (dl.status !== 200) throw new Error('Download failed');
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(dl.uri, { mimeType: 'application/pdf', dialogTitle: 'Share Meeting Minutes' });
      } else {
        setShareError('Sharing is not available on this device.');
      }
    } catch {
      setShareError('Failed to load PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  if (!meeting) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const formatTime = (iso: string) => dayjs(iso).format('hh:mm A');
  const formatDur = (s: number) => {
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m`;
    return `${m}m`;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Meeting Details
        </Text>
        {meeting.pdf_url ? (
          <TouchableOpacity
            onPress={handleSharePdf}
            style={styles.pdfBtn}
            disabled={downloading}
          >
            <Text style={styles.pdfBtnText}>{downloading ? '...' : '📤 PDF'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {!!shareError && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>⚠️  {shareError}</Text>
          </View>
        )}

        {/* Title */}
        <View style={styles.titleCard}>
          <Text style={styles.meetingTitle}>{meeting.meeting_title}</Text>
          <Text style={styles.clientName}>{meeting.client_name}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>
              {dayjs(meeting.meeting_date).format('DD MMM YYYY')}
            </Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>{formatTime(meeting.start_time)}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>{formatDur(meeting.duration_seconds)}</Text>
          </View>
          {meeting.address && (
            <Text style={styles.locationText} numberOfLines={2}>
              📍 {meeting.address}
            </Text>
          )}
        </View>

        {/* Attendees */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Attendees</Text>
          <View style={styles.attendeeTable}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCell, styles.tableCellHeader, { flex: 1.2 }]}>Name</Text>
              <Text style={[styles.tableCell, styles.tableCellHeader, { flex: 1 }]}>Role</Text>
              <Text style={[styles.tableCell, styles.tableCellHeader, { flex: 1 }]}>Company</Text>
            </View>
            {(meeting.attendees ?? []).map((a, i) => (
              <View key={a.id ?? i} style={[styles.tableRow, i % 2 === 0 && styles.tableRowAlt]}>
                <Text style={[styles.tableCell, { flex: 1.2 }]}>{a.name}</Text>
                <Text style={[styles.tableCell, { flex: 1 }]}>{a.designation || '—'}</Text>
                <Text style={[styles.tableCell, { flex: 1 }]}>{a.company || '—'}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Summary */}
        {meeting.summary && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Summary</Text>
            <Text style={styles.bodyText}>{meeting.summary}</Text>
          </View>
        )}

        {/* Agenda */}
        {meeting.agenda && meeting.agenda.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Agenda</Text>
            {meeting.agenda.map((a, i) => (
              <View key={i} style={styles.bulletRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.bodyText}>{a}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Key Points */}
        {meeting.key_discussion_points && meeting.key_discussion_points.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Key Discussion Points</Text>
            {meeting.key_discussion_points.map((p, i) => (
              <View key={i} style={styles.bulletRow}>
                <Text style={styles.number}>{i + 1}.</Text>
                <Text style={styles.bodyText}>{p}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Decisions */}
        {meeting.decisions && meeting.decisions.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Decisions Made</Text>
            {meeting.decisions.map((d, i) => (
              <View key={i} style={styles.bulletRow}>
                <Text style={styles.bullet}>✓</Text>
                <Text style={styles.bodyText}>{d}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Action Items */}
        {meeting.action_items && meeting.action_items.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Action Items</Text>
            {meeting.action_items.map((item, i) => (
              <View key={i} style={styles.actionItem}>
                <View style={styles.actionItemHeader}>
                  <Text style={styles.actionTask}>{item.task}</Text>
                  <Text style={[styles.priorityBadge, (styles as any)[`priority_${item.priority.toLowerCase()}`]]}>
                    {item.priority}
                  </Text>
                </View>
                <Text style={styles.actionMeta}>
                  Owner: {item.owner}
                  {item.deadline ? `  ·  Due: ${item.deadline}` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Next Steps */}
        {meeting.next_steps && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Next Steps</Text>
            <Text style={styles.bodyText}>{meeting.next_steps}</Text>
          </View>
        )}

        {/* Prepared By */}
        <View style={[styles.card, { marginBottom: SPACING.xl }]}>
          <Text style={styles.cardTitle}>Prepared By</Text>
          <Text style={styles.bodyText}>{meeting.prepared_by}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: COLORS.textSecondary, fontSize: FONTS.sizes.base },
  errorBanner: {
    backgroundColor: '#FEF2F2', borderRadius: RADIUS.md, borderWidth: 1,
    borderColor: '#FECACA', padding: SPACING.md, marginBottom: SPACING.md,
  },
  errorText: { fontSize: FONTS.sizes.sm, color: COLORS.error, lineHeight: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn: { width: 60 },
  backText: { color: COLORS.primary, fontSize: FONTS.sizes.base, fontWeight: '600' },
  headerTitle: {
    flex: 1,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  pdfBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.sm,
    width: 60,
    alignItems: 'center',
  },
  pdfBtnText: { color: COLORS.white, fontSize: FONTS.sizes.sm, fontWeight: '700' },
  scroll: { flex: 1 },
  scrollContent: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  titleCard: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  meetingTitle: { fontSize: FONTS.sizes.xl, fontWeight: '800', color: COLORS.white },
  clientName: { fontSize: FONTS.sizes.base, color: 'rgba(255,255,255,0.8)', marginTop: 2, marginBottom: SPACING.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginBottom: SPACING.xs },
  metaText: { fontSize: FONTS.sizes.sm, color: 'rgba(255,255,255,0.75)' },
  metaDot: { color: 'rgba(255,255,255,0.4)' },
  locationText: { fontSize: FONTS.sizes.sm, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.sm,
  },
  cardTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '700',
    color: COLORS.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: SPACING.sm,
  },
  attendeeTable: { borderRadius: RADIUS.sm, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  tableHeader: { flexDirection: 'row', backgroundColor: COLORS.primary, padding: SPACING.sm },
  tableRow: { flexDirection: 'row', padding: SPACING.sm },
  tableRowAlt: { backgroundColor: COLORS.surfaceSecondary },
  tableCell: { fontSize: FONTS.sizes.sm, color: COLORS.text },
  tableCellHeader: { color: COLORS.white, fontWeight: '700' },
  bulletRow: { flexDirection: 'row', gap: SPACING.xs, marginBottom: SPACING.xs },
  bullet: { fontSize: FONTS.sizes.base, color: COLORS.primary, marginTop: 2 },
  number: { fontSize: FONTS.sizes.base, color: COLORS.primary, fontWeight: '700', width: 24, marginTop: 2 },
  bodyText: { flex: 1, fontSize: FONTS.sizes.base, color: COLORS.text, lineHeight: 22 },
  actionItem: {
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  actionItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  actionTask: { flex: 1, fontSize: FONTS.sizes.base, fontWeight: '600', color: COLORS.text, marginRight: SPACING.sm },
  actionMeta: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  priorityBadge: { fontSize: FONTS.sizes.xs, fontWeight: '700', paddingHorizontal: SPACING.xs, paddingVertical: 2, borderRadius: RADIUS.sm, backgroundColor: COLORS.surfaceSecondary },
  priority_high: { color: COLORS.error },
  priority_medium: { color: COLORS.warning },
  priority_low: { color: COLORS.success },
});
