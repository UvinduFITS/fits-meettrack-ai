import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Platform,
} from 'react-native';

const IS_WEB = Platform.OS === 'web';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../hooks/useAuth';
import { getUserMeetings } from '../services/meetingService';
import { MeetingRecord, RootStackParamList } from '../types';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../constants/theme';
import { useMeetingStore } from '../stores/meetingStore';
import dayjs from 'dayjs';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function StatusBadge({ status }: { status: MeetingRecord['status'] }) {
  const map = {
    recording: { label: 'Recording', bg: COLORS.recordingRed, color: COLORS.white },
    processing: { label: 'Processing', bg: COLORS.warning, color: COLORS.white },
    completed: { label: 'Completed', bg: COLORS.success, color: COLORS.white },
    failed: { label: 'Failed', bg: COLORS.error, color: COLORS.white },
  };
  const s = map[status] ?? map.completed;
  return (
    <View style={[styles.badge, { backgroundColor: s.bg }]}>
      <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
    </View>
  );
}

function MeetingCard({ meeting, onPress }: { meeting: MeetingRecord; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.meetingCard} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.meetingCardHeader}>
        <View style={styles.meetingCardLeft}>
          <Text style={styles.meetingTitle} numberOfLines={1}>
            {meeting.meeting_title}
          </Text>
          <Text style={styles.meetingClient}>{meeting.client_name}</Text>
        </View>
        <StatusBadge status={meeting.status} />
      </View>
      <View style={styles.meetingCardFooter}>
        <Text style={styles.meetingMeta}>
          {dayjs(meeting.meeting_date).format('DD MMM YYYY')}
        </Text>
        {meeting.duration_seconds > 0 && (
          <Text style={styles.meetingMeta}>
            {Math.round(meeting.duration_seconds / 60)} min
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const { user, profile, signOut } = useAuth();
  const resetMeeting = useMeetingStore((s) => s.resetMeeting);
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadMeetings = useCallback(async () => {
    if (!user) return;
    const data = await getUserMeetings(user.id);
    setMeetings(data);
  }, [user]);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadMeetings();
    setRefreshing(false);
  };

  const handleStartMeeting = () => {
    resetMeeting();
    navigation.navigate('MeetingSetup');
  };

  const handleSignOut = () => {
    if (IS_WEB) {
      if (window.confirm('Are you sure you want to sign out?')) signOut();
    } else {
      const { Alert } = require('react-native');
      Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: signOut },
      ]);
    }
  };

  const displayName = profile?.full_name ?? user?.email ?? 'User';
  const firstName = displayName.split(' ')[0];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good {getTimeOfDay()},</Text>
          <Text style={styles.userName}>{firstName}</Text>
        </View>
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Start Meeting CTA */}
        <TouchableOpacity
          style={styles.startButton}
          onPress={handleStartMeeting}
          activeOpacity={0.9}
        >
          <View style={styles.startButtonIcon}>
            <Text style={styles.startButtonIconText}>▶</Text>
          </View>
          <View style={styles.startButtonTextArea}>
            <Text style={styles.startButtonLabel}>Start Meeting</Text>
            <Text style={styles.startButtonSub}>Tap to begin recording and capture your meeting</Text>
          </View>
        </TouchableOpacity>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{meetings.length}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>
              {meetings.filter((m) => m.status === 'completed').length}
            </Text>
            <Text style={styles.statLabel}>Completed</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>
              {meetings.filter((m) => dayjs(m.meeting_date).isSame(dayjs(), 'month')).length}
            </Text>
            <Text style={styles.statLabel}>This Month</Text>
          </View>
        </View>

        {/* Meetings List */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Meetings</Text>
          {meetings.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={styles.emptyTitle}>No meetings yet</Text>
              <Text style={styles.emptyText}>
                Tap "Start Meeting" above to record your first meeting.
              </Text>
            </View>
          ) : (
            meetings.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                onPress={() => navigation.navigate('MeetingDetails', { meetingId: m.id! })}
              />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.md,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  greeting: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  userName: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.text,
  },
  signOutBtn: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
  },
  signOutText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.primaryLight,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  startButton: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.lg,
    ...SHADOWS.lg,
  },
  startButtonIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  startButtonIconText: {
    fontSize: 22,
    color: COLORS.white,
  },
  startButtonTextArea: {
    flex: 1,
  },
  startButtonLabel: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '800',
    color: COLORS.white,
    marginBottom: 2,
  },
  startButtonSub: {
    fontSize: FONTS.sizes.sm,
    color: 'rgba(255,255,255,0.75)',
  },
  statsRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.sm,
  },
  statNumber: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: '800',
    color: COLORS.primary,
  },
  statLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontWeight: '500',
    marginTop: 2,
  },
  section: {
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  meetingCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.sm,
  },
  meetingCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.xs,
  },
  meetingCardLeft: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  meetingTitle: {
    fontSize: FONTS.sizes.base,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 2,
  },
  meetingClient: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  meetingCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: SPACING.xs,
  },
  meetingMeta: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
  },
  badge: {
    paddingVertical: 3,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.full,
  },
  badgeText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: SPACING.md,
  },
  emptyTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  emptyText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    maxWidth: 260,
  },
});
