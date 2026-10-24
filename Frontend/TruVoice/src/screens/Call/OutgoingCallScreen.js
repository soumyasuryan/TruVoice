import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ROUTES } from '../../constants/routes';
import { colors } from '../../theme';
import { safeGoBack } from '../../utils/navigationHelper';
import { showAlert } from '../../store/alertStore';

import { agoraService } from '../../services/agora/agoraService';
import { api } from '../../services/api/client';
import { useCallStore } from '../../store/callStore';

export default function OutgoingCallScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const contact = route.params?.contact || {
    name: 'Unknown User',
    number: '',
    initials: 'UU',
    userId: 'target-user-id',
  };

  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [dtmfText, setDtmfText] = useState('');
  const [callStatusText, setCallStatusText] = useState('Calling...');

  const setCallId = useCallStore((s) => s.setCallId);
  const setChannelName = useCallStore((s) => s.setChannelName);
  const setStatus = useCallStore((s) => s.setStatus);

  const activeCallIdRef = useRef(null);
  const activeChannelRef = useRef(null);
  const hasNavigatedRef = useRef(false);
  const callInitiatedRef = useRef(false);

  const navigateToActiveCall = useCallback((targetCallId, channelName) => {
    if (hasNavigatedRef.current) return;
    hasNavigatedRef.current = true;
    console.log(`[OutgoingCallScreen] navigateToActiveCall: callId=${targetCallId}, channel=${channelName}, agoraCurrentChannel=${agoraService.currentChannel}`);
    setStatus('active');

    navigation.replace(ROUTES.ACTIVE_CALL, {
      contact,
      callId: targetCallId,
      channelName,
    });
  }, [navigation, contact, setStatus]);

  useEffect(() => {
    if (callInitiatedRef.current) return;
    callInitiatedRef.current = true;

    let isMounted = true;
    let timeoutTimer = null;
    let pollInterval = null;

    async function initiateAgoraCall() {
      try {
        const targetUserId = contact.userId || contact.id || contact.number || null;
        if (!targetUserId) {
          if (isMounted) {
            setCallStatusText('This contact is not on TruVoice');
            setTimeout(() => safeGoBack(navigation, ROUTES.MAIN_TABS), 1800);
          }
          return;
        }

        const channelName = `truvoice_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        activeChannelRef.current = channelName;
        setChannelName(channelName);
        setStatus('outgoing');

        const micGranted = await agoraService.requestMicrophonePermission();
        if (!micGranted) {
          if (isMounted) {
            setCallStatusText('Microphone permission required');
            setTimeout(() => safeGoBack(navigation, ROUTES.MAIN_TABS), 2000);
          }
          return;
        }

        const logRes = await api.logCall(channelName, targetUserId, contact.number || contact.phone_number);
        const loggedCallId = logRes.data?.call_id;
        if (loggedCallId) {
          setCallId(loggedCallId);
          activeCallIdRef.current = String(loggedCallId);
        }

        try {
          const tokenRes = await api.getAgoraToken(channelName);
          const token = tokenRes.data?.token;
          const uid = tokenRes.data?.uid;
          const joined = await agoraService.joinChannel(channelName, token, uid);
          if (!joined) {
            if (loggedCallId) {
              await api.updateCallStatus(loggedCallId, 'canceled');
            }
            await agoraService.leaveChannel();
            if (isMounted) {
              setCallStatusText('Call setup failed');
              setTimeout(() => safeGoBack(navigation, ROUTES.MAIN_TABS), 1500);
            }
            return;
          }
        } catch (tokErr) {
          console.warn('Error joining Agora channel on outgoing call:', tokErr);
          if (loggedCallId) {
            await api.updateCallStatus(loggedCallId, 'canceled');
          }
          await agoraService.leaveChannel();
          if (isMounted) {
            setCallStatusText('Call setup failed');
            setTimeout(() => safeGoBack(navigation, ROUTES.MAIN_TABS), 1500);
          }
          return;
        }

        if (isMounted) setCallStatusText('Ringing...');

        if (loggedCallId) {
          pollInterval = setInterval(async () => {
            if (hasNavigatedRef.current) return;
            try {
              const callDetail = await api.getVoiceCallDetail(loggedCallId);
              const pollStatus = callDetail.data?.status;
              console.log(`[OutgoingCallScreen] poll: callId=${loggedCallId}, status=${pollStatus}`);
              if (pollStatus === 'answered') {
                console.log(`[OutgoingCallScreen] poll detected 'answered' → navigateToActiveCall`);
                navigateToActiveCall(loggedCallId, channelName);
              } else if (['ended', 'no-answer', 'no_answer', 'declined', 'canceled', 'busy'].includes(pollStatus)) {
                if (isMounted) {
                  setCallStatusText(
                    callDetail.data.status === 'declined'
                      ? 'Call Declined'
                      : callDetail.data.status === 'no-answer' || callDetail.data.status === 'no_answer'
                        ? 'No Answer'
                        : 'Call Ended',
                  );
                  if (pollInterval) clearInterval(pollInterval);
                  await agoraService.leaveChannel();
                  setTimeout(() => safeGoBack(navigation, ROUTES.MAIN_TABS), 1500);
                }
              }
            } catch (e) {
              // Silent poller catch
            }
          }, 2000);
        }

        timeoutTimer = setTimeout(async () => {
          if (isMounted && !hasNavigatedRef.current) {
            setCallStatusText('No Answer');
            if (pollInterval) clearInterval(pollInterval);
            if (loggedCallId) {
              await api.updateCallStatus(loggedCallId, 'no-answer');
            }
            await agoraService.leaveChannel();
            setTimeout(() => safeGoBack(navigation, ROUTES.MAIN_TABS), 1500);
          }
        }, 45000);

      } catch (err) {
        console.warn('Outgoing Agora call error:', err);
        if (isMounted) {
          setCallStatusText('Call Failed');
          await agoraService.leaveChannel();
          setTimeout(() => {
            if (isMounted) safeGoBack(navigation, ROUTES.MAIN_TABS);
          }, 2000);
        }
      }
    }

    const handleCallResponse = (data) => {
      const currentCallId = activeCallIdRef.current;
      const isThisCall = !data.callId || !currentCallId || String(data.callId) === String(currentCallId);
      console.log(`[OutgoingCallScreen] call_response: action=${data.action}, callId=${data.callId}, isThisCall=${isThisCall}, hasNavigated=${hasNavigatedRef.current}`);

      if (data.action === 'answered' && isThisCall) {
        console.log(`[OutgoingCallScreen] WS 'answered' → navigateToActiveCall`);
        navigateToActiveCall(
          data.callId || currentCallId,
          data.channelName || activeChannelRef.current,
        );
        return;
      }

      if (hasNavigatedRef.current) {
        return;
      }

      if (['declined', 'decline', 'busy', 'ended', 'canceled'].includes(data.action) && isThisCall) {
        if (isMounted) {
          setCallStatusText(data.action === 'declined' || data.action === 'decline' ? 'Call Declined' : 'Call Ended');
          agoraService.leaveChannel().catch(() => {});
          setTimeout(() => safeGoBack(navigation, ROUTES.MAIN_TABS), 1500);
        }
      }
    };

    const handleRemoteJoined = () => {
      if (isMounted && !hasNavigatedRef.current) {
        setCallStatusText('Connected');
        const callId = activeCallIdRef.current;
        const channel = activeChannelRef.current;
        if (callId && channel) {
          navigateToActiveCall(callId, channel);
        }
      }
    };

    agoraService.on('call_response', handleCallResponse);
    agoraService.on('remote_user_joined', handleRemoteJoined);
    initiateAgoraCall();

    return () => {
      isMounted = false;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (pollInterval) clearInterval(pollInterval);
      agoraService.off('call_response', handleCallResponse);
      agoraService.off('remote_user_joined', handleRemoteJoined);
    };
  }, [navigation, contact, setCallId, setChannelName, setStatus, navigateToActiveCall]);

  const handleToggleSpeaker = async () => {
    try {
      const next = !isSpeaker;
      setIsSpeaker(next);
      await agoraService.setSpeaker(next);
    } catch (e) {
      console.warn('Error setting speaker mode:', e);
    }
  };

  const handleToggleMute = async () => {
    const next = !isMuted;
    setIsMuted(next);
    await agoraService.setMuted(next);
  };

  const handleEnd = async () => {
    const callId = activeCallIdRef.current;
    try {
      if (callId) {
        await api.updateCallStatus(callId, 'canceled');
      }
      await agoraService.leaveChannel();
    } catch (e) {
      console.warn('Error ending outgoing call:', e);
    }
    safeGoBack(navigation, ROUTES.MAIN_TABS);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />
      <View
        style={[
          styles.container,
          { paddingBottom: Math.max(insets.bottom + 20, 40) },
        ]}
      >
        <TouchableOpacity
          onPress={handleEnd}
          style={styles.backButton}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>

        <View style={styles.centerSection}>
          <View style={styles.avatarWrapper}>
            <LinearGradient
              colors={['#3B82F6', '#6366F1']}
              style={styles.avatarGradient}
            >
              <Text style={styles.avatarText}>{contact.initials || 'PN'}</Text>
            </LinearGradient>
          </View>

          <Text style={styles.callerName}>{contact.name}</Text>
          <Text style={styles.callStatus}>{callStatusText}</Text>

          <Text style={styles.timerText}>00:00</Text>
        </View>

        <View style={styles.shieldNote}>
          <Ionicons name="shield-checkmark-outline" size={18} color="#22C55E" style={styles.shieldIcon} />
          <Text style={styles.shieldNoteText}>
            Voice analysis starts the moment they answer.
          </Text>
        </View>

        <View style={styles.controlsRow}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleToggleMute}
            style={[styles.controlBtn, isMuted && styles.controlBtnActive]}
          >
            <Ionicons name={isMuted ? 'mic-off' : 'mic'} size={22} color={isMuted ? '#EF4444' : '#FFFFFF'} />
            <Text style={[styles.controlLabel, isMuted && { color: '#EF4444' }]}>Mute</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleToggleSpeaker}
            style={[styles.controlBtn, isSpeaker && styles.controlBtnActive]}
          >
            <Ionicons name={isSpeaker ? 'volume-high' : 'volume-medium-outline'} size={22} color="#FFFFFF" />
            <Text style={styles.controlLabel}>Speaker</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setShowKeypad(true)}
            style={[styles.controlBtn, showKeypad && styles.controlBtnActive]}
          >
            <Ionicons name="keypad-outline" size={22} color="#FFFFFF" />
            <Text style={styles.controlLabel}>Keypad</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => {
              showAlert(
                'Add Caller',
                'Conference calling is not supported in demo mode. Choose a contact to add once connected to backend.',
                [{ text: 'OK' }],
                'info',
              );
            }}
            style={styles.controlBtn}
          >
            <Ionicons name="person-add-outline" size={22} color="#FFFFFF" />
            <Text style={styles.controlLabel}>Add</Text>
          </TouchableOpacity>
        </View>

        {showKeypad && (
          <View style={styles.keypadOverlay}>
            <View style={styles.keypadOverlayHeader}>
              <Text style={styles.keypadOverlayTitle}>Keypad: {dtmfText}</Text>
              <TouchableOpacity onPress={() => setShowKeypad(false)} style={styles.keypadCloseBtn}>
                <Ionicons name="close-circle" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <View style={styles.keypadOverlayGrid}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((digit) => (
                <TouchableOpacity
                  key={digit}
                  style={styles.keypadOverlayKey}
                  onPress={() => setDtmfText((prev) => prev + digit)}
                >
                  <Text style={styles.keypadOverlayKeyText}>{digit}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <View style={styles.endCallContainer}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={handleEnd}
            style={styles.endCallBtn}
          >
            <Ionicons name="call-sharp" size={28} color="#FFFFFF" style={{ transform: [{ rotate: '135deg' }] }} />
          </TouchableOpacity>
          <Text style={styles.endLabel}>End</Text>
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
    justifyContent: 'space-between',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  centerSection: {
    alignItems: 'center',
    marginTop: 20,
  },
  avatarWrapper: {
    marginBottom: 24,
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
  callerName: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  callStatus: {
    color: colors.textSecondary,
    fontSize: 16,
    marginTop: 6,
  },
  timerText: {
    color: colors.textSecondary,
    fontSize: 36,
    fontWeight: '600',
    marginTop: 20,
  },
  shieldNote: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131316',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  shieldIcon: {
    marginRight: 10,
  },
  shieldNoteText: {
    color: colors.textSecondary,
    fontSize: 13,
    flex: 1,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  controlBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  controlBtnActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  controlLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    position: 'absolute',
    bottom: -22,
  },
  endCallContainer: {
    alignItems: 'center',
  },
  endCallBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  endLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 8,
  },
  keypadOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#131316',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 20,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    zIndex: 1000,
  },
  keypadOverlayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  keypadOverlayTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  keypadCloseBtn: {
    padding: 4,
  },
  keypadOverlayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 12,
  },
  keypadOverlayKey: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  keypadOverlayKeyText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '600',
  },
});
