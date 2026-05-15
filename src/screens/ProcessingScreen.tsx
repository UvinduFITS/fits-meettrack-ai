import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, ProcessingStatus } from '../types';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';
import { useMeetingStore } from '../stores/meetingStore';
import {
  processMeetingViaEdgeFunction,
  getMeetingById,
  updateMeetingRecord,
} from '../services/meetingService';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'Processing'>;

const STAGES = [
  { key: 'uploading', label: 'Uploading recording', icon: '📤' },
  { key: 'transcribing', label: 'Analysing your meeting', icon: '🎯' },
  { key: 'summarizing', label: 'Generating meeting minutes', icon: '✍️' },
  { key: 'generating_pdf', label: 'Creating PDF document', icon: '📄' },
  { key: 'saving', label: 'Saving your records', icon: '💾' },
  { key: 'done', label: 'Complete!', icon: '✅' },
];

function StageRow({ stage, status }: { stage: typeof STAGES[0]; status: 'pending' | 'active' | 'done' }) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (status === 'active') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(shimmer, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(shimmer, { toValue: 0, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    } else {
      shimmer.stopAnimation();
      shimmer.setValue(status === 'done' ? 1 : 0);
    }
  }, [status]);

  const opacity = status === 'pending' ? 0.35 : 1;

  return (
    <View style={[styles.stageRow, { opacity }]}>
      <View style={[styles.stageIcon, status === 'active' && styles.stageIconActive, status === 'done' && styles.stageIconDone]}>
        <Text style={styles.stageIconText}>
          {status === 'done' ? '✓' : stage.icon}
        </Text>
      </View>
      <Text style={[styles.stageLabel, status === 'active' && styles.stageLabelActive]}>
        {stage.label}
      </Text>
      {status === 'active' && (
        <Animated.View style={[styles.activeDot, { opacity: shimmer }]} />
      )}
    </View>
  );
}

export function ProcessingScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { meetingId } = route.params;
  const audioChunks = useMeetingStore((s) => s.audioChunks);
  const nextSteps = useMeetingStore((s) => s.nextSteps);
  const setAiResults = useMeetingStore((s) => s.setAiResults);
  const setPdfUrl = useMeetingStore((s) => s.setPdfUrl);
  const [currentStage, setCurrentStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const hasStarted = useRef(false);

  useEffect(() => {
    if (!hasStarted.current) {
      hasStarted.current = true;
      runProcessing();
    }
  }, []);

  const animateProgress = (toValue: number) => {
    Animated.timing(progressAnim, {
      toValue,
      duration: 600,
      useNativeDriver: false,
    }).start();
  };

  const runProcessing = async () => {
    try {
      setCurrentStage(1); // transcribing
      animateProgress(0.25);

      const chunkPaths = audioChunks
        .filter((c) => c.storagePath)
        .map((c) => c.storagePath!);

      await processMeetingViaEdgeFunction(
        meetingId,
        chunkPaths,
        nextSteps,
        (status: ProcessingStatus) => {
          if (status.stage === 'summarizing') {
            setCurrentStage(2);
            animateProgress(0.5);
          } else if (status.stage === 'generating_pdf') {
            setCurrentStage(3);
            animateProgress(0.75);
          } else if (status.stage === 'saving') {
            setCurrentStage(4);
            animateProgress(0.9);
          } else if (status.stage === 'done') {
            setCurrentStage(5);
            animateProgress(1);
          }
        }
      );

      // Load final meeting data
      const meeting = await getMeetingById(meetingId);
      if (meeting) {
        setAiResults({
          agenda: meeting.agenda ?? [],
          keyDiscussionPoints: meeting.key_discussion_points ?? [],
          decisions: meeting.decisions ?? [],
          actionItems: meeting.action_items ?? [],
          summary: meeting.summary ?? '',
        });
        if (meeting.pdf_url) setPdfUrl(meeting.pdf_url);
      }

      setTimeout(() => {
        navigation.replace('MeetingResult', { meetingId });
      }, 1000);
    } catch (err: any) {
      setError(err?.message ?? 'Processing failed. Please try again.');
      await updateMeetingRecord(meetingId, { status: 'failed' });
    }
  };

  const getStageStatus = (index: number): 'pending' | 'active' | 'done' => {
    if (index < currentStage) return 'done';
    if (index === currentStage) return 'active';
    return 'pending';
  };

  if (error) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Processing Failed</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Text
            style={styles.retryBtn}
            onPress={() => {
              setError(null);
              setCurrentStage(0);
              runProcessing();
            }}
          >
            Retry
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.headerArea}>
          <Text style={styles.title}>Creating Your Meeting Minutes</Text>
          <Text style={styles.subtitle}>
            Please keep the app open. This usually takes 1–2 minutes.
          </Text>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
        </View>

        {/* Stages */}
        <View style={styles.stagesCard}>
          {STAGES.map((stage, index) => (
            <StageRow
              key={stage.key}
              stage={stage}
              status={getStageStatus(index)}
            />
          ))}
        </View>

        <Text style={styles.disclaimer}>
          Your recording will be deleted after processing is complete.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
    padding: SPACING.lg,
    justifyContent: 'center',
  },
  headerArea: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  progressTrack: {
    height: 6,
    backgroundColor: COLORS.border,
    borderRadius: 3,
    marginBottom: SPACING.xl,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 3,
  },
  stagesCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.lg,
  },
  stageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm + 2,
    gap: SPACING.md,
  },
  stageIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageIconActive: {
    backgroundColor: '#EEF4FF',
  },
  stageIconDone: {
    backgroundColor: '#E8FAF0',
  },
  stageIconText: {
    fontSize: 16,
  },
  stageLabel: {
    flex: 1,
    fontSize: FONTS.sizes.base,
    color: COLORS.text,
  },
  stageLabelActive: {
    fontWeight: '700',
    color: COLORS.primary,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  disclaimer: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: SPACING.md,
  },
  errorTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  errorText: {
    fontSize: FONTS.sizes.base,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.xl,
    lineHeight: 22,
  },
  retryBtn: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.primary,
    textDecorationLine: 'underline',
  },
});
