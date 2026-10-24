import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
} from 'react-native-reanimated';
import { colors } from '../../theme';

function WaveBar({ delay, heightMultiplier = 1 }) {
  const height = useSharedValue(8);

  useEffect(() => {
    height.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(26 * heightMultiplier, { duration: 400 }),
          withTiming(6, { duration: 400 }),
        ),
        -1,
        true,
      ),
    );
  }, [delay, heightMultiplier, height]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: height.value,
  }));

  return <Animated.View style={[styles.bar, animatedStyle]} />;
}

export default function VoiceShieldCard({ onStartCall }) {
  const barMultipliers = [0.4, 0.7, 1.0, 0.6, 1.2, 0.8, 1.4, 0.9, 1.5, 1.1, 1.6, 1.0, 0.7, 1.3, 0.8, 0.5, 0.9, 0.4];

  return (
    <View style={styles.cardContainer}>
      <View style={styles.cardHeader}>
        <View style={styles.protectedBadge}>
          <Text style={styles.protectedBadgeText}>Protected</Text>
        </View>
        <View style={styles.shieldIconContainer}>
          <Ionicons name="shield-checkmark-outline" size={22} color={colors.success} />
        </View>
      </View>

      <Text style={styles.cardTitle}>Voice shield is live</Text>
      <Text style={styles.cardSubtitle}>Analyzing every 20s of every call</Text>

      {/* Live Waveform animation */}
      <View style={styles.waveformContainer}>
        {barMultipliers.map((mult, index) => (
          <WaveBar key={index} delay={index * 55} heightMultiplier={mult} />
        ))}
      </View>


    </View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    backgroundColor: '#131316',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 8,
    marginVertical: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  protectedBadge: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  protectedBadgeText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '600',
  },
  shieldIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  cardSubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 4,
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 36,
    marginVertical: 16,
    gap: 3,
  },
  bar: {
    width: 3,
    backgroundColor: colors.success,
    borderRadius: 2,
  },
  ctaButton: {
    backgroundColor: '#3B82F6',
    borderRadius: 28,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  buttonIcon: {
    marginRight: 8,
  },
  ctaButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
