import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { LoginScreen } from '../screens/LoginScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { MeetingSetupScreen } from '../screens/MeetingSetupScreen';
import { RecordingScreen } from '../screens/RecordingScreen';
import { NextStepsScreen } from '../screens/NextStepsScreen';
import { ProcessingScreen } from '../screens/ProcessingScreen';
import { MeetingResultScreen } from '../screens/MeetingResultScreen';
import { MeetingDetailsScreen } from '../screens/MeetingDetailsScreen';
import { RootStackParamList } from '../types';
import { COLORS } from '../constants/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

function LoadingScreen() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={COLORS.primary} />
    </View>
  );
}

export function AppNavigator() {
  const { session, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!session ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen
              name="MeetingSetup"
              component={MeetingSetupScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="Recording"
              component={RecordingScreen}
              options={{ animation: 'slide_from_right', gestureEnabled: false }}
            />
            <Stack.Screen
              name="NextSteps"
              component={NextStepsScreen}
              options={{ animation: 'slide_from_right', gestureEnabled: false }}
            />
            <Stack.Screen
              name="Processing"
              component={ProcessingScreen}
              options={{ animation: 'fade', gestureEnabled: false }}
            />
            <Stack.Screen
              name="MeetingResult"
              component={MeetingResultScreen}
              options={{ animation: 'slide_from_right', gestureEnabled: false }}
            />
            <Stack.Screen
              name="MeetingDetails"
              component={MeetingDetailsScreen}
              options={{ animation: 'slide_from_right' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
});
