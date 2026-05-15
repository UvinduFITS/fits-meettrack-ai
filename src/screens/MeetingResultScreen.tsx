import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from 'react-native';

const IS_WEB = Platform.OS === 'web';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { RootStackParamList, MeetingRecord } from '../types';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../constants/theme';
import { getMeetingById } from '../services/meetingService';
import dayjs from 'dayjs';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'MeetingResult'>;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );
}

function BulletItem({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

export function MeetingResultScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { meetingId } = route.params;
  const [meeting, setMeeting] = useState<MeetingRecord | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [shareError, setShareError] = useState('');

  useEffect(() => {
    getMeetingById(meetingId).then(setMeeting);
  }, [meetingId]);

  const handleShare = async () => {
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
        await Sharing.shareAsync(dl.uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Share Meeting Minutes',
        });
      } else {
        setShareError('Sharing is not available on this device.');
      }
    } catch {
      setShareError('Failed to download the PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const formatDuration = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m} min`;
  };

  if (!meeting) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Loading meeting minutes...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Meeting Minutes</Text>
        <TouchableOpacity
          style={[styles.shareBtn, downloading && styles.shareBtnDisabled]}
          onPress={handleShare}
          disabled={downloading}
        >
          <Text style={styles.shareBtnText}>
            {downloading ? 'Downloading...' : '📤 Share PDF'}
          </Text>
        </TouchableOpacity>
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

        {/* Success Banner */}
        <View style={styles.successBanner}>
          <Text style={styles.successIcon}>✅</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.successTitle}>Meeting Minutes Ready</Text>
            <Text style={styles.successSub}>
              Your PDF has been saved and is ready to share.
            </Text>
          </View>
        </View>

        {/* Meeting Details */}
        <Section title="Meeting Details">
          <View style={styles.detailsGrid}>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Date</Text>
              <Text style={styles.detailValue}>
                {dayjs(meeting.meeting_date).format('DD MMMM YYYY')}
              </Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Duration</Text>
              <Text style={styles.detailValue}>{formatDuration(meeting.duration_seconds)}</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Client</Text>
              <Text style={styles.detailValue}>{meeting.client_name}</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Attendees</Text>
              <Text style={styles.detailValue}>{meeting.attendees?.length ?? 0}</Text>
            </View>
          </View>
          {meeting.address && (
            <View style={styles.locationRow}>
              <Text style={styles.detailLabel}>📍 Location</Text>
              <Text style={styles.detailValue}>{meeting.address}</Text>
            </View>
          )}
        </Section>

        {/* Summary */}
        {meeting.summary && (
          <Section title="Meeting Summary">
            <Text style={styles.summaryText}>{meeting.summary}</Text>
          </Section>
        )}

        {/* Agenda */}
        {meeting.agenda && meeting.agenda.length > 0 && (
          <Section title="Agenda">
            {meeting.agenda.map((item, i) => (
              <BulletItem key={i} text={item} />
            ))}
          </Section>
        )}

        {/* Key Discussion Points */}
        {meeting.key_discussion_points && meeting.key_discussion_points.length > 0 && (
          <Section title="Key Discussion Points">
            {meeting.key_discussion_points.map((item, i) => (
              <View key={i} style={styles.numberedRow}>
                <Text style={styles.numberDot}>{i + 1}.</Text>
                <Text style={styles.bulletText}>{item}</Text>
              </View>
            ))}
          </Section>
        )}

        {/* Decisions */}
        {meeting.decisions && meeting.decisions.length > 0 && (
          <Section title="Decisions Made">
            {meeting.decisions.map((item, i) => (
              <BulletItem key={i} text={item} />
            ))}
          </Section>
        )}

        {/* Action Items */}
        {meeting.action_items && meeting.action_items.length > 0 && (
          <Section title="Action Items">
            <View style={styles.actionTable}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableCell, styles.tableCellHeader, { flex: 2 }]}>Task</Text>
                <Text style={[styles.tableCell, styles.tableCellHeader, { flex: 1 }]}>Owner</Text>
                <Text style={[styles.tableCell, styles.tableCellHeader, { flex: 1 }]}>Priority</Text>
              </View>
              {meeting.action_items.map((item, i) => (
                <View key={i} style={[styles.tableRow, i % 2 === 0 && styles.tableRowAlt]}>
                  <Text style={[styles.tableCell, { flex: 2 }]}>{item.task}</Text>
                  <Text style={[styles.tableCell, { flex: 1 }]}>{item.owner}</Text>
                  <Text style={[styles.tableCell, (styles as any)[`priority_${item.priority.toLowerCase()}`], { flex: 1 }]}>
                    {item.priority}
                  </Text>
                </View>
              ))}
            </View>
          </Section>
        )}

        {/* Next Steps */}
        {meeting.next_steps && (
          <Section title="Next Steps">
            <Text style={styles.nextStepsText}>{meeting.next_steps}</Text>
          </Section>
        )}

        {/* Done Button */}
        <TouchableOpacity
          style={styles.doneBtn}
          onPress={() => navigation.navigate('Home')}
          activeOpacity={0.85}
        >
          <Text style={styles.doneBtnText}>Back to Home</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: FONTS.sizes.base, color: COLORS.textSecondary },
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
  headerTitle: { fontSize: FONTS.sizes.md, fontWeight: '700', color: COLORS.text },
  shareBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
  },
  shareBtnDisabled: { opacity: 0.5 },
  shareBtnText: { fontSize: FONTS.sizes.sm, fontWeight: '700', color: COLORS.white },
  scroll: { flex: 1 },
  scrollContent: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8FAF0',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: '#A7F3C3',
    gap: SPACING.sm,
  },
  successIcon: { fontSize: 28 },
  successTitle: { fontSize: FONTS.sizes.base, fontWeight: '700', color: '#166534' },
  successSub: { fontSize: FONTS.sizes.sm, color: '#166534', opacity: 0.8 },
  section: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.sm,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: SPACING.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionContent: {},
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  detailItem: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
  },
  detailLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailValue: { fontSize: FONTS.sizes.base, color: COLORS.text, fontWeight: '600' },
  locationRow: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.sm },
  summaryText: { fontSize: FONTS.sizes.base, color: COLORS.text, lineHeight: 24 },
  bulletRow: { flexDirection: 'row', marginBottom: SPACING.xs, gap: SPACING.xs },
  bulletDot: { fontSize: FONTS.sizes.base, color: COLORS.primary, marginTop: 1 },
  bulletText: { flex: 1, fontSize: FONTS.sizes.base, color: COLORS.text, lineHeight: 22 },
  numberedRow: { flexDirection: 'row', marginBottom: SPACING.xs, gap: SPACING.xs },
  numberDot: {
    fontSize: FONTS.sizes.base,
    color: COLORS.primary,
    fontWeight: '700',
    width: 20,
    marginTop: 1,
  },
  actionTable: { borderRadius: RADIUS.sm, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.sm,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.sm,
  },
  tableRowAlt: { backgroundColor: COLORS.surfaceSecondary },
  tableCell: { fontSize: FONTS.sizes.sm, color: COLORS.text, paddingRight: SPACING.xs },
  tableCellHeader: { color: COLORS.white, fontWeight: '700' },
  priority_high: { color: COLORS.error, fontWeight: '700' },
  priority_medium: { color: COLORS.warning, fontWeight: '700' },
  priority_low: { color: COLORS.success, fontWeight: '700' },
  nextStepsText: { fontSize: FONTS.sizes.base, color: COLORS.text, lineHeight: 24 },
  doneBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.xl,
    paddingVertical: SPACING.md + 4,
    alignItems: 'center',
    marginTop: SPACING.sm,
    ...SHADOWS.md,
  },
  doneBtnText: { fontSize: FONTS.sizes.md, fontWeight: '800', color: COLORS.white },
});
