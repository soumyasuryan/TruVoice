import React, { useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallStore } from '../store/callStore';
import { useHistoryStore } from '../store/historyStore';
import { agoraService } from '../services/agora/agoraService';
import { api } from '../services/api/client';
import { useNavigation } from '@react-navigation/native';
import { ROUTES } from '../constants/routes';

export default function IncomingCallOverlay() {
  const navigation = useNavigation();
  const incomingCall = useCallStore((s) => s.incomingCall);
  const clearIncomingCall = useCallStore((s) => s.clearIncomingCall);
  const setCallId = useCallStore((s) => s.setCallId);
  const setChannelName = useCallStore((s) => s.setChannelName);

  useEffect(() => {
    if (!incomingCall?.callId) return undefined;

    const timeout = setTimeout(async () => {
      const currentCall = useCallStore.getState().incomingCall;
      if (!currentCall || String(currentCall.callId) !== String(incomingCall.callId)) return;

      try {
        await api.updateCallStatus(incomingCall.callId, 'no-answer');
        useHistoryStore.getState().addMissedCall({
          callId: incomingCall.callId,
          callerName: incomingCall.callerName,
          callerNumber: incomingCall.callerNumber || 'App-to-App Call',
          callerUserId: incomingCall.callerUserId,
        });
      } catch (error) {
        console.warn('Unable to mark unanswered incoming call:', error);
      } finally {
        clearIncomingCall();
      }
    }, 45000);

    return () => clearTimeout(timeout);
  }, [incomingCall, clearIncomingCall]);

  useEffect(() => {
    if (!incomingCall?.callId) return undefined;

    const handleCallResponse = (data) => {
      const isThisCall = String(data.callId) === String(incomingCall.callId);
      const terminalActions = ['ended', 'declined', 'canceled', 'busy', 'no-answer', 'no_answer'];
      if (!isThisCall || !terminalActions.includes(data.action)) return;

      clearIncomingCall();
    };

    agoraService.on('call_response', handleCallResponse);
    return () => agoraService.off('call_response', handleCallResponse);
  }, [incomingCall, clearIncomingCall]);

  if (!incomingCall) return null;

  const handleAccept = async () => {
    try {
      const { channelName, callId, callerName, callerUserId } = incomingCall;
      console.log(`[IncomingCallOverlay] handleAccept: callId=${callId}, channel=${channelName}`);
      setCallId(callId);
      setChannelName(channelName);
      if (callId) agoraService.markCallHandled(callId);

      const micGranted = await agoraService.requestMicrophonePermission();
      if (!micGranted) {
        console.warn('Microphone permission denied — cannot accept call');
        return;
      }

      const tokenRes = await api.getAgoraToken(channelName);
      const token = tokenRes.data?.token;
      const uid = tokenRes.data?.uid;
      console.log(`[IncomingCallOverlay] got Agora token (uid=${uid}), joining channel ${channelName}...`);

      const joined = await agoraService.joinChannel(channelName, token, uid);
      if (!joined) {
        console.warn(`[IncomingCallOverlay] joinChannel FAILED for ${channelName}`);
        if (callId) {
          await api.updateCallStatus(callId, 'canceled');
        }
        clearIncomingCall();
        return;
      }

      console.log(`[IncomingCallOverlay] joined channel, sending respondToCallInvitation...`);
      await agoraService.respondToCallInvitation(callerUserId, 'accept', channelName, callId);

      clearIncomingCall();

      console.log(`[IncomingCallOverlay] navigating to ACTIVE_CALL...`);
      navigation.navigate(ROUTES.ACTIVE_CALL, {
        contact: {
          name: callerName || 'Incoming Caller',
          number: 'App-to-App Call',
          initials: (callerName || 'IC').substring(0, 2).toUpperCase(),
          userId: callerUserId,
        },
        callId,
        channelName,
      });
    } catch (err) {
      console.warn('[IncomingCallOverlay] Error accepting incoming call:', err);
      if (incomingCall.callId) {
        try {
          await api.updateCallStatus(incomingCall.callId, 'canceled');
          useHistoryStore.getState().addMissedCall({
            callId: incomingCall.callId,
            callerName: incomingCall.callerName,
            callerNumber: 'App-to-App Call',
            callerUserId: incomingCall.callerUserId,
          });
        } catch (e) {
          console.warn('Unable to mark failed incoming call as canceled:', e);
        }
      }
      clearIncomingCall();
    }
  };

  const handleDecline = async () => {
    try {
      const { channelName, callerUserId, callId, callerName } = incomingCall;
      if (callId) agoraService.markCallHandled(callId);
      await agoraService.respondToCallInvitation(callerUserId, 'decline', channelName, callId);
      if (callId) {
        useHistoryStore.getState().addMissedCall({
          callId,
          callerName,
          callerNumber: 'App-to-App Call',
          callerUserId,
        });
      }
    } catch (err) {
      console.warn('Error declining call:', err);
    } finally {
      clearIncomingCall();
    }
  };

  const callerInitials = (incomingCall.callerName || 'IC')
    .substring(0, 2)
    .toUpperCase();

  return (
    <Modal animationType="slide" transparent={false} visible={!!incomingCall}>
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {/* Header */}
          <Text style={styles.callTypeLabel}>Incoming TruVoice Call...</Text>

          {/* Caller Avatar */}
          <View style={styles.avatarWrapper}>
            <LinearGradient
              colors={['#2563EB', '#7C3AED']}
              style={styles.avatarGradient}
            >
              <Text style={styles.avatarText}>{callerInitials}</Text>
            </LinearGradient>
          </View>

          {/* Caller Name */}
          <Text style={styles.callerName}>
            {incomingCall.callerName || 'Unknown Caller'}
          </Text>

          {/* Shield Badge */}
          <View style={styles.shieldBadge}>
            <Ionicons name="shield-checkmark" size={16} color="#22C55E" />
            <Text style={styles.shieldText}>Real-Time AI Scam Protection Active</Text>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionsRow}>
            {/* Decline */}
            <View style={styles.actionBtnWrapper}>
              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.actionBtn, styles.declineBtn]}
                onPress={handleDecline}
              >
                <Ionicons
                  name="call-sharp"
                  size={32}
                  color="#FFFFFF"
                  style={{ transform: [{ rotate: '135deg' }] }}
                />
              </TouchableOpacity>
              <Text style={styles.actionLabel}>Decline</Text>
            </View>

            {/* Accept */}
            <View style={styles.actionBtnWrapper}>
              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.actionBtn, styles.acceptBtn]}
                onPress={handleAccept}
              >
                <Ionicons name="call" size={32} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={styles.actionLabel}>Accept</Text>
            </View>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  callTypeLabel: {
    color: '#3B82F6',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  avatarWrapper: {
    marginVertical: 20,
  },
  avatarGradient: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 48,
    fontWeight: '700',
  },
  callerName: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
  },
  shieldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181B',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  shieldText: {
    color: '#A1A1AA',
    fontSize: 13,
    marginLeft: 8,
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
  actionBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
  },
  declineBtn: {
    backgroundColor: '#EF4444',
  },
  acceptBtn: {
    backgroundColor: '#22C55E',
  },
  actionLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 10,
  },
});
