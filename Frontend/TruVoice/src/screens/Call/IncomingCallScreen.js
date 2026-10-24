import React, { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { ROUTES } from '../../constants/routes';
import { colors } from '../../theme';
import { safeGoBack } from '../../utils/navigationHelper';

import { agoraService } from '../../services/agora/agoraService';
import { api } from '../../services/api/client';
import { useCallStore } from '../../store/callStore';
import { useHistoryStore } from '../../store/historyStore';

function IncomingWaveBar({ delay, heightMult = 1 }) {
  const height = useSharedValue(6);

  useEffect(() => {
    height.value = withRepeat(
      withSequence(
        withTiming(24 * heightMult, { duration: 350 }),
        withTiming(4, { duration: 350 }),
      ),
      -1,
      true,
    );
  }, [heightMult, height]);

  const animStyle = useAnimatedStyle(() => ({
    height: height.value,
  }));

  return <Animated.View style={[styles.waveBar, animStyle]} />;
}

export default function IncomingCallScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const contact = route.params?.contact || {
    name: 'Elena Voss',
    number: '+1 415 890',
    initials: 'EV',
    colors: ['#EC4899', '#F97316'],
  };
  const callId = route.params?.callId || useCallStore.getState().callId;
  const channelName = route.params?.channelName || useCallStore.getState().channelName;
  const callerUserId = route.params?.callerUserId || contact.userId;

  const handleDecline = async () => {
    try {
      if (callId) agoraService.markCallHandled(callId);
      if (callerUserId && channelName) {
        await agoraService.respondToCallInvitation(callerUserId, 'decline', channelName, callId);
      }
      if (callId) {
        useHistoryStore.getState().addMissedCall({
          callId,
          callerName: contact.name,
          callerNumber: contact.number || 'App-to-App Call',
          callerUserId,
        });
      }
    } catch (e) {
      console.warn('Error declining call:', e);
    }
    safeGoBack(navigation, ROUTES.MAIN_TABS);
  };

  const handleAccept = async () => {
    try {
      if (channelName) {
        const tokenRes = await api.getAgoraToken(channelName);
        const token = tokenRes.data?.token;
        const uid = tokenRes.data?.uid;
        const joined = await agoraService.joinChannel(channelName, token, uid);
        if (!joined) {
          if (callId) {
            await api.updateCallStatus(callId, 'canceled');
            useHistoryStore.getState().addMissedCall({
              callId,
              callerName: contact.name,
              callerNumber: contact.number || 'App-to-App Call',
              callerUserId,
            });
          }
          return;
        }
      }

      if (callerUserId && channelName) {
        await agoraService.respondToCallInvitation(callerUserId, 'accept', channelName, callId);
      }

      navigation.replace(ROUTES.ACTIVE_CALL, { contact, callId, channelName });
    } catch (err) {
      console.warn('Error in IncomingCallScreen handleAccept:', err);
      if (callId) {
        try {
          await api.updateCallStatus(callId, 'canceled');
          useHistoryStore.getState().addMissedCall({
            callId,
            callerName: contact.name,
            callerNumber: contact.number || 'App-to-App Call',
            callerUserId,
          });
        } catch (e) {
          console.warn('Unable to mark failed call as canceled:', e);
        }
      }
    }
  };

  const barMultipliers = [0.4, 0.8, 1.2, 0.6, 1.5, 0.9, 1.8, 1.0, 1.4, 0.7, 1.1, 0.5];

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />
      <View
        style={[
          styles.container,
          { paddingBottom: Math.max(insets.bottom + 20, 30) },
        ]}
      >
        {/* Top AI Protection Status Pill */}
        <View style={styles.protectionPill}>
          <Ionicons name="shield-checkmark-outline" size={16} color="#22C55E" style={{ marginRight: 6 }} />
          <Text style={styles.protectionPillText}>AI protection ready</Text>
        </View>

        {/* Center Caller Information */}
        <View style={styles.callerContainer}>
          <View style={styles.avatarGlowWrapper}>
            <LinearGradient
              colors={contact.colors || ['#EC4899', '#F97316']}
              style={styles.avatarGradient}
            >
              <Text style={styles.avatarText}>{contact.initials || 'EV'}</Text>
            </LinearGradient>
            <View style={styles.outerRing} />
          </View>

          <Text style={styles.callerName}>{contact.name || 'Elena Voss'}</Text>
          <Text style={styles.callSubtext}>Incoming secure call · WebRTC</Text>

          <View style={styles.encryptedPill}>
            <Text style={styles.encryptedText}>End-to-end encrypted</Text>
          </View>
        </View>

        {/* Audio Waveform */}
        <View style={styles.waveformContainer}>
          {barMultipliers.map((mult, idx) => (
            <IncomingWaveBar key={idx} delay={idx * 60} heightMult={mult} />
          ))}
        </View>

        {/* Bottom Actions: Decline / Accept */}
        <View style={styles.actionsRow}>
          <View style={styles.actionBtnWrapper}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleDecline}
              style={[styles.callBtn, styles.declineBtn]}
            >
              <Ionicons name="call-sharp" size={28} color="#FFFFFF" style={{ transform: [{ rotate: '135deg' }] }} />
            </TouchableOpacity>
            <Text style={styles.actionLabel}>Decline</Text>
          </View>

          <View style={styles.actionBtnWrapper}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleAccept}
              style={[styles.callBtn, styles.acceptBtn]}
            >
              <Ionicons name="call" size={28} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.actionLabel}>Accept</Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#09090B',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  container: {
    flex: 1,
    backgroundColor: '#09090B',
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 30,
  },
  protectionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.2)',
    marginTop: 10,
  },
  protectionPillText: {
    color: '#22C55E',
    fontSize: 13,
    fontWeight: '600',
  },
  callerContainer: {
    alignItems: 'center',
  },
  avatarGlowWrapper: {
    position: 'relative',
    marginBottom: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGradient: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 48,
    fontWeight: '700',
  },
  outerRing: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
  },
  callerName: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  callSubtext: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 6,
  },
  encryptedPill: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 12,
  },
  encryptedText: {
    color: '#60A5FA',
    fontSize: 12,
    fontWeight: '600',
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 36,
  },
  waveBar: {
    width: 3,
    backgroundColor: '#3B82F6',
    borderRadius: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingHorizontal: 30,
  },
  actionBtnWrapper: {
    alignItems: 'center',
  },
  callBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  declineBtn: {
    backgroundColor: '#EF4444',
    shadowColor: '#EF4444',
  },
  acceptBtn: {
    backgroundColor: '#22C55E',
    shadowColor: '#22C55E',
  },
  actionLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 8,
  },
});
