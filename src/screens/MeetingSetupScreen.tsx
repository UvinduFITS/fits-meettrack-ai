import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Attendee, MeetingSetupData, RootStackParamList } from '../types';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../constants/theme';
import { FormField } from '../components/ui/FormField';
import { Button } from '../components/ui/Button';
import { useAuth } from '../hooks/useAuth';
import { nanoid } from '../utils/nanoid';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function AttendeeRow({
  attendee,
  onUpdate,
  onRemove,
  index,
}: {
  attendee: Attendee;
  onUpdate: (field: keyof Attendee, value: string) => void;
  onRemove: () => void;
  index: number;
}) {
  return (
    <View style={styles.attendeeRow}>
      <View style={styles.attendeeRowHeader}>
        <Text style={styles.attendeeRowTitle}>Attendee {index + 1}</Text>
        <TouchableOpacity onPress={onRemove} style={styles.removeBtn}>
          <Text style={styles.removeBtnText}>Remove</Text>
        </TouchableOpacity>
      </View>
      <FormField
        label="Name"
        value={attendee.name}
        onChangeText={(v) => onUpdate('name', v)}
        placeholder="Full name"
        required
      />
      <FormField
        label="Designation"
        value={attendee.designation}
        onChangeText={(v) => onUpdate('designation', v)}
        placeholder="Job title / role"
      />
      <FormField
        label="Company"
        value={attendee.company}
        onChangeText={(v) => onUpdate('company', v)}
        placeholder="Company name"
      />
    </View>
  );
}

export function MeetingSetupScreen() {
  const navigation = useNavigation<Nav>();
  const { profile, user } = useAuth();

  const [meetingTitle, setMeetingTitle] = useState('');
  const [clientName, setClientName] = useState('');
  const [preparedBy, setPreparedBy] = useState(
    profile?.full_name ?? user?.email ?? ''
  );
  const [attendees, setAttendees] = useState<Attendee[]>([
    { id: nanoid(), name: '', designation: '', company: '' },
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!meetingTitle.trim()) newErrors.meetingTitle = 'Meeting title is required.';
    if (!clientName.trim()) newErrors.clientName = 'Client name is required.';
    if (!preparedBy.trim()) newErrors.preparedBy = 'Prepared by is required.';
    if (attendees.some((a) => !a.name.trim())) {
      newErrors.attendees = 'All attendees must have a name.';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const addAttendee = () => {
    setAttendees((prev) => [
      ...prev,
      { id: nanoid(), name: '', designation: '', company: '' },
    ]);
  };

  const removeAttendee = (id: string) => {
    if (attendees.length === 1) {
      Alert.alert('Cannot Remove', 'At least one attendee is required.');
      return;
    }
    setAttendees((prev) => prev.filter((a) => a.id !== id));
  };

  const updateAttendee = (id: string, field: keyof Attendee, value: string) => {
    setAttendees((prev) =>
      prev.map((a) => (a.id === id ? { ...a, [field]: value } : a))
    );
  };

  const handleContinue = () => {
    if (!validate()) {
      Alert.alert('Incomplete Form', 'Please fill in all required fields before continuing.');
      return;
    }

    const setupData: MeetingSetupData = {
      meetingTitle: meetingTitle.trim(),
      clientName: clientName.trim(),
      attendees: attendees.filter((a) => a.name.trim()),
      preparedBy: preparedBy.trim(),
    };

    navigation.navigate('Recording', { setupData });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Meeting Setup</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Meeting Info */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Meeting Information</Text>
            <View style={styles.card}>
              <FormField
                label="Meeting Title"
                value={meetingTitle}
                onChangeText={setMeetingTitle}
                placeholder="e.g. Quarterly Business Review"
                error={errors.meetingTitle}
                required
              />
              <FormField
                label="Client Name"
                value={clientName}
                onChangeText={setClientName}
                placeholder="e.g. Acme Corporation"
                error={errors.clientName}
                required
              />
              <FormField
                label="Prepared By"
                value={preparedBy}
                onChangeText={setPreparedBy}
                placeholder="Your name"
                error={errors.preparedBy}
                required
                style={{ marginBottom: 0 }}
              />
            </View>
          </View>

          {/* Attendees */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Attendees</Text>
            {errors.attendees && (
              <Text style={styles.sectionError}>{errors.attendees}</Text>
            )}
            {attendees.map((attendee, index) => (
              <AttendeeRow
                key={attendee.id}
                attendee={attendee}
                index={index}
                onUpdate={(field, value) => updateAttendee(attendee.id, field, value)}
                onRemove={() => removeAttendee(attendee.id)}
              />
            ))}
            <TouchableOpacity style={styles.addAttendeeBtn} onPress={addAttendee} activeOpacity={0.7}>
              <Text style={styles.addAttendeeBtnText}>+ Add Attendee</Text>
            </TouchableOpacity>
          </View>

          {/* Info Banner */}
          <View style={styles.infoBanner}>
            <Text style={styles.infoIcon}>ℹ️</Text>
            <Text style={styles.infoText}>
              Date, time, and location will be captured automatically when you start recording.
            </Text>
          </View>

          {/* Continue Button */}
          <Button
            label="Continue to Recording"
            onPress={handleContinue}
            size="lg"
            style={styles.continueBtn}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
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
  backBtn: {
    padding: SPACING.xs,
    width: 60,
  },
  backBtnText: {
    color: COLORS.primary,
    fontSize: FONTS.sizes.base,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: COLORS.text,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
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
  sectionError: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.error,
    marginBottom: SPACING.sm,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.sm,
  },
  attendeeRow: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.sm,
    ...SHADOWS.sm,
  },
  attendeeRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  attendeeRowTitle: {
    fontSize: FONTS.sizes.base,
    fontWeight: '700',
    color: COLORS.primary,
  },
  removeBtn: {
    paddingVertical: 4,
    paddingHorizontal: SPACING.sm,
    backgroundColor: COLORS.recordingRedLight,
    borderRadius: RADIUS.sm,
  },
  removeBtnText: {
    color: COLORS.recordingRed,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },
  addAttendeeBtn: {
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
  },
  addAttendeeBtnText: {
    color: COLORS.primary,
    fontSize: FONTS.sizes.base,
    fontWeight: '700',
  },
  infoBanner: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'flex-start',
    gap: SPACING.sm,
  },
  infoIcon: {
    fontSize: 16,
    marginTop: 1,
  },
  infoText: {
    flex: 1,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  continueBtn: {
    borderRadius: RADIUS.xl,
  },
});
