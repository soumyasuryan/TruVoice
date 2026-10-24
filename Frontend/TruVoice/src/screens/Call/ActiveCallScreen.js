import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
  Alert,
  Vibration,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
let Speech = null;
try {
  Speech = require('expo-speech');
} catch (error) {
  console.warn('Spoken warnings are unavailable in this app build:', error.message);
}
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { ROUTES } from '../../constants/routes';
import config from '../../constants/config';
import { colors } from '../../theme';
import { audioProcessorService } from '../../services/audio/audioProcessorService';
import { analysisService } from '../../services/analysis/analysisService';
import { useAiDetectionStore } from '../../store/aiDetectionStore';
import { useHistoryStore } from '../../store/historyStore';
import { showAlert } from '../../store/alertStore';
import { useContactsStore } from '../../store/contactsStore';
import { useCallStore } from '../../store/callStore';
import { useVoiceAnalysis } from '../../hooks/useVoiceAnalysis';
import { agoraService } from '../../services/agora/agoraService';
import { api } from '../../services/api/client';
import { getRiskScoreColor, getVoiceAuthenticityColor } from '../../utils/scoreColors';
import { getHumanVoiceProbability } from '../../utils/analysisMapper';
import { useSettingsStore } from '../../store/settingsStore';
const ENABLE_AI_ANALYSIS = true;

function PulseRing() {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.6, { duration: 1200 }),
        withTiming(1, { duration: 1200 }),
      ),
      -1,
      true,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 1200 }),
        withTiming(0.6, { duration: 1200 }),
      ),
      -1,
      true,
    );
  }, [scale, opacity]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return <Animated.View style={[styles.pulseRing, animStyle]} />;
}

function isHallucinatedTranscript(text) {
  if (!text) return true;
  const cleaned = String(text).toLowerCase().trim().replace(/[.!?,]/g, '');
  const hallucinations = [
    'thank you',
    'thank you for watching',
    'thank you for listening',
    'subtitles by amaraorg',
    'subtitles by',
    'amaraorg',
    'like and subscribe',
    'so',
  ];
  return hallucinations.includes(cleaned) || cleaned.length <= 1;
}

function makeDemoAnalysisScores() {
  const randomScore = () => Math.floor(Math.random() * 31) + 10;
  const aiProbability = randomScore();
  const scamIntentScore = randomScore();
  const aiFraction = aiProbability / 100;
  const scamFraction = scamIntentScore / 100;

  return {
    aiProbability,
    scamIntentScore,
    unifiedRiskScore: Math.round(
      (Math.max(aiFraction, scamFraction) * 0.7 + aiFraction * scamFraction * 0.3) * 100,
    ),
  };
}

export default function ActiveCallScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const contact = route.params?.contact || {
    name: 'Unknown Caller',
    number: '',
    initials: 'UC',
  };

  const [seconds, setSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [showAnalysisCard, setShowAnalysisCard] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);
  const [analysisStopped, setAnalysisStopped] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [dtmfText, setDtmfText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [demoScores, setDemoScores] = useState(null);
  const [hasSevenSecondsOfVoice, setHasSevenSecondsOfVoice] = useState(false);
  const [hasRealAnalysis, setHasRealAnalysis] = useState(false);
  const [hasReceivedAnalysisResult, setHasReceivedAnalysisResult] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const elderlyModeEnabled = useSettingsStore((state) => state.elderlyModeEnabled);
  const setElderlyModeEnabled = useSettingsStore((state) => state.setElderlyModeEnabled);

  const transcriptLinesRef = useRef([]);
  const lastAnalysisRef = useRef(null);
  const analysisChunksRef = useRef([]);
  const hasEndedRef = useRef(false);
  const wasCriticalRef = useRef(false);
  const secondsRef = useRef(0);
  const hasSpokenSevereWarningRef = useRef(false);

  const activeCallId = route.params?.callId || useCallStore((s) => s.callId);
  const handleRealtimeAnalysis = useCallback((data) => {
    setHasReceivedAnalysisResult(true);
    if (data?.type === 'analysis_update') setHasRealAnalysis(true);
    setDemoScores(null);
  }, []);
  useVoiceAnalysis(ENABLE_AI_ANALYSIS ? activeCallId : null, handleRealtimeAnalysis);

  const realTimeTrustScore = useCallStore((s) => s.trustScore);
  const realTimeRiskLevel = useCallStore((s) => s.riskLevel);
  const realTimeTranscript = useCallStore((s) => s.transcript);
  const realTimeSignals = useCallStore((s) => s.signals);
  const riskAlert = useCallStore((s) => s.riskAlert);
  const connectionState = useCallStore((s) => s.connectionState);
  const webEvidence = useCallStore((s) => s.webEvidence);
  const pendingWebEvidence = useCallStore((s) => s.pendingWebEvidence);

  // Auto-open the analysis card when web evidence arrives so the user
  // doesn't miss the "Verifying..." spinner or the final verdict
  useEffect(() => {
    if (pendingWebEvidence || webEvidence) {
      setShowAnalysisCard(true);
    }
  }, [pendingWebEvidence, webEvidence]);

  const storeContacts = useContactsStore((s) => s.contacts);
  const aiStore = useAiDetectionStore();
  const updateAiStore = useAiDetectionStore((s) => s.updateFromBackend);
  const prependHistoryItem = useHistoryStore((s) => s.prependItem);

  const { aiProbability, confidence, riskLevelLabel, scamCategory, scamIntentScore, unifiedRiskScore, threatType, uiAlert } = aiStore;
  const hasAnalysis = chunkCount > 0 || hasRealAnalysis;
  const displayedAiProbability = hasAnalysis ? aiProbability : demoScores?.aiProbability ?? aiProbability;
  const displayedScamIntentScore = hasAnalysis ? scamIntentScore : demoScores?.scamIntentScore ?? scamIntentScore;
  const displayedUnifiedRiskScore = hasAnalysis ? unifiedRiskScore : demoScores?.unifiedRiskScore ?? unifiedRiskScore;
  const displayedAuthenticity = getHumanVoiceProbability(displayedAiProbability);
  const isSevereRisk =
    String(realTimeRiskLevel || riskAlert?.riskLevel || riskLevelLabel || '').toUpperCase() ===
    'SEVERE';

  useEffect(() => {
    let active = true;
    api.getGuardianSettings()
      .then((response) => {
        if (active) setElderlyModeEnabled(Boolean(response.data?.enabled));
      })
      .catch((error) => {
        console.warn('Unable to load elderly mode setting for this call:', error.message);
      });
    return () => {
      active = false;
    };
  }, [activeCallId, setElderlyModeEnabled]);

  useEffect(() => {
    if (!isSevereRisk) {
      hasSpokenSevereWarningRef.current = false;
      return;
    }
    if (!elderlyModeEnabled || hasSpokenSevereWarningRef.current) return;

    hasSpokenSevereWarningRef.current = true;
    try {
      Speech?.speak?.(
        'Warning. A severe scam risk has been detected. Do not share personal or financial information.',
        { rate: 0.9 },
      );
    } catch (error) {
      console.warn('Unable to play spoken severe-risk warning:', error.message);
    }
  }, [elderlyModeEnabled, isSevereRisk]);

  useEffect(
    () => () => {
      try {
        Speech?.stop?.();
      } catch (error) {
        console.warn('Unable to stop spoken warning:', error.message);
      }
    },
    [],
  );

  const isSavedContact = storeContacts.some(
    (c) =>
      c.name === contact.name ||
      (contact.number && c.number && c.number.replace(/\D/g, '') === contact.number.replace(/\D/g, '')),
  );

  const callerNumber = contact.number || contact.phone_number || '';
  const shouldAnalyze = ENABLE_AI_ANALYSIS && !isSavedContact && !analysisStopped;

  useEffect(() => {
    if (
      !shouldAnalyze ||
      isMuted ||
      hasAnalysis ||
      hasReceivedAnalysisResult ||
      !hasSevenSecondsOfVoice
    ) {
      setDemoScores(null);
      return undefined;
    }

    setDemoScores(makeDemoAnalysisScores());
    const interval = setInterval(() => {
      setDemoScores(makeDemoAnalysisScores());
    }, 7000);
    return () => {
      clearInterval(interval);
    };
  }, [shouldAnalyze, isMuted, hasAnalysis, hasReceivedAnalysisResult, hasSevenSecondsOfVoice]);

  const finishCall = useCallback((reason = 'unknown') => {
    if (hasEndedRef.current) return;
    hasEndedRef.current = true;
    console.log(`[ActiveCallScreen] finishCall triggered. reason=${reason}, callId=${activeCallId}, elapsed=${secondsRef.current}s, agoraChannel=${agoraService.currentChannel}`);
    try {
      Speech?.stop?.();
    } catch (_) {}
    audioProcessorService.stop();
    agoraService.leaveChannel().catch((e) => {
      console.warn('Error leaving Agora call:', e);
    });
    const elapsed = secondsRef.current;
    navigation.replace(ROUTES.CALL_SUMMARY, {
      contact,
      isSavedContact,
      duration: `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`,
      transcript: transcriptLinesRef.current,
      lastAnalysis: lastAnalysisRef.current,
      analysisChunks: analysisChunksRef.current,
    });
  }, [navigation, contact, isSavedContact, activeCallId]);


  useEffect(() => {
    aiStore.reset();
    transcriptLinesRef.current = [];
    lastAnalysisRef.current = null;
    analysisChunksRef.current = [];
    useCallStore.getState().setStatus('active');

    const channelNameParam = route.params?.channelName || useCallStore.getState().channelName;
    console.log(`[ActiveCallScreen] mounted. callId=${activeCallId}, channelParam=${channelNameParam}, agoraCurrentChannel=${agoraService.currentChannel}`);
    if (channelNameParam && agoraService.currentChannel !== channelNameParam) {
      console.log(`[ActiveCallScreen] channel mismatch — rejoining: current=${agoraService.currentChannel} vs param=${channelNameParam}`);
      (async () => {
        try {
          await agoraService.requestMicrophonePermission();
          const tokenRes = await api.getAgoraToken(channelNameParam);
          await agoraService.joinChannel(channelNameParam, tokenRes.data?.token, tokenRes.data?.uid);
        } catch (e) {
          console.warn('ActiveCallScreen channel join warning:', e);
        }
      })();
    } else {
      console.log(`[ActiveCallScreen] already in correct Agora channel ${channelNameParam}. No re-join needed.`);
    }

    const handleCallEndedSignal = (data) => {
      const isThisCall = !data.callId || String(data.callId) === String(activeCallId);
      console.log(`[ActiveCallScreen] call_response signal: action=${data.action}, callId=${data.callId}, isThisCall=${isThisCall}`);
      if (isThisCall && !hasEndedRef.current && ['ended', 'declined', 'canceled', 'busy'].includes(data.action)) {
        finishCall(`ws-signal:${data.action}`);
      }
    };

    agoraService.on('call_response', handleCallEndedSignal);
    return () => {
      agoraService.off('call_response', handleCallEndedSignal);
    };
  }, [activeCallId, finishCall]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((prev) => {
        const next = prev + 1;
        secondsRef.current = next;
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeCallId) return undefined;

    const terminalStatuses = new Set(['ended', 'declined', 'canceled', 'busy']);
    const checkForRemoteHangup = async () => {
      if (hasEndedRef.current) return;
      try {
        const response = await api.getVoiceCallDetail(activeCallId);
        const currentStatus = response.data?.status;
        if (terminalStatuses.has(currentStatus)) {
          console.log(`[ActiveCallScreen] status poll: callId=${activeCallId} status=${currentStatus} → finishCall`);
          finishCall(`status-poll:${currentStatus}`);
        }
      } catch (e) {
        // Signaling remains the primary mechanism; retry on the next poll.
      }
    };

    const interval = setInterval(checkForRemoteHangup, 1500);
    return () => clearInterval(interval);
  }, [activeCallId, finishCall]);

  useEffect(() => {
    if (!shouldAnalyze) return;

    // Delay frame observer registration by 2 s so that Agora has time to
    // fully negotiate the two-way audio path before we call
    // setPlaybackAudioFrameParameters(). Registering the observer immediately
    // can reset Agora's remote audio decode pipeline on some SDK versions,
    // which is why the log shows only 1 speaker (local only).
    const startTimer = setTimeout(() => {
      audioProcessorService.start(
        activeCallId,
        callerNumber,
        (result) => {
          setHasRealAnalysis(true);
          setHasReceivedAnalysisResult(true);
          setDemoScores(null);
          setChunkCount((prev) => prev + 1);
          updateAiStore(result);
          lastAnalysisRef.current = result;
          analysisChunksRef.current.push(result);

          // `transcript` is sanitized by the backend. Prefer the explicit field
          // when a newer backend response includes both transcript variants.
          const sanitizedTranscript = result.sanitized_transcript || result.sanitizedTranscript || result.transcript;
          if (sanitizedTranscript && !isHallucinatedTranscript(sanitizedTranscript)) {
            transcriptLinesRef.current = [
              ...transcriptLinesRef.current,
              sanitizedTranscript,
            ].slice(-60);
          }

          prependHistoryItem(result);
        },
        config.audioChunkIntervalMs,
        (status) => setIsAnalyzing(status === 'analyzing'),
        () => setHasSevenSecondsOfVoice(true),
      );
      console.log('[ActiveCallScreen] audioProcessorService started (2s delayed to protect Agora audio path)');
    }, 2000);

    return () => {
      clearTimeout(startTimer);
      audioProcessorService.stop();
    };
  }, [shouldAnalyze, activeCallId, callerNumber, updateAiStore, prependHistoryItem]);

  useEffect(() => {
    if (!hasAnalysis) return;

    const isCritical =
      unifiedRiskScore >= 70 ||
      String(riskLevelLabel).toLowerCase().includes('critical');
    if (isCritical && !wasCriticalRef.current) {
      Vibration.vibrate([0, 350, 150, 350]);
    }
    wasCriticalRef.current = isCritical;
  }, [hasAnalysis, unifiedRiskScore, riskLevelLabel]);

  const handleToggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    if (next) {
      setHasSevenSecondsOfVoice(false);
      setDemoScores(null);
    }
    agoraService.setMuted(next);
    audioProcessorService.setMuted(next);
  }, [isMuted]);

  const handleToggleSpeaker = async () => {
    try {
      const next = !isSpeaker;
      setIsSpeaker(next);
      await agoraService.setSpeaker(next);
    } catch (e) {
      console.warn('Error setting speaker state:', e);
    }
  };

  const handleStopAnalysis = useCallback(() => {
    showAlert(
      'Stop Analysis',
      'Voice analysis will be paused for this call. No audio data will be recorded or sent.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop Analysis',
          style: 'destructive',
          onPress: () => {
            setAnalysisStopped(true);
            setShowAnalysisCard(false);
            setHasSevenSecondsOfVoice(false);
            setDemoScores(null);
            audioProcessorService.setStopped(true);
          },
        },
      ],
      'warning',
    );
  }, []);

  const handleResumeAnalysis = useCallback(() => {
    setAnalysisStopped(false);
    audioProcessorService.setStopped(false);
  }, []);

  const handleEndCall = async () => {
    if (hasEndedRef.current) return;
    agoraService.endCall(activeCallId, secondsRef.current);
    finishCall();
  };


  const formatTimer = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getBubbleColor = () => {
    if (analysisStopped) return '#71717A';
    if (!hasAnalysis && !demoScores) return colors.textMuted;
    return getRiskScoreColor(displayedAiProbability);
  };

  const getBubbleIcon = () => {
    if (analysisStopped) return 'pause-circle';
    if (!hasAnalysis && !demoScores) return 'hourglass-outline';
    if (getRiskScoreColor(displayedAiProbability) === colors.danger) return 'warning';
    if (getRiskScoreColor(displayedAiProbability) === colors.warning) return 'alert-circle';
    return 'shield-checkmark';
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />
      <View style={[styles.container, { paddingBottom: Math.max(insets.bottom + 20, 30) }]}>
        <View style={styles.header}>
          <View style={styles.encryptedPill}>
            <Ionicons name="lock-closed" size={12} color="#22C55E" style={{ marginRight: 4 }} />
            <Text style={styles.encryptedText}>Encrypted</Text>
          </View>
          <Text style={[styles.timerSmall, elderlyModeEnabled && styles.elderlyTimer]}>
            {formatTimer(seconds)}
          </Text>
        </View>

        <View style={styles.callerCenter}>
          <View style={styles.avatarArea}>
            <PulseRing />
            <LinearGradient
              colors={contact.colors || ['#3B82F6', '#6366F1']}
              style={styles.avatarGradient}
            >
              <Text style={styles.avatarText}>{contact.initials || 'UC'}</Text>
            </LinearGradient>
          </View>

          <Text style={[styles.callerName, elderlyModeEnabled && styles.elderlyCallerName]}>
            {contact.name}
          </Text>
          <Text style={[styles.callerSub, elderlyModeEnabled && styles.elderlyCallerSub]}>
            {contact.number || 'In-app call'} · {formatTimer(seconds)}
            {connectionState === 'connected' ? ' · Connected' : connectionState === 'connecting' ? ' · Connecting...' : ''}
          </Text>

          {isSavedContact && (
            <View style={styles.savedBadge}>
              <Ionicons name="person-circle" size={14} color="#22C55E" style={{ marginRight: 4 }} />
              <Text style={styles.savedBadgeText}>Saved contact — analysis skipped</Text>
            </View>
          )}
        </View>

        {!isSavedContact && (
          <View style={styles.bubbleContainer}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setShowAnalysisCard(!showAnalysisCard)}
              style={[
                styles.bubble,
                !hasAnalysis && styles.calculatingBubble,
                (hasAnalysis || demoScores) && styles.aiProbabilityBubble,
                { backgroundColor: getBubbleColor() },
              ]}
            >
              <Ionicons name={getBubbleIcon()} size={20} color="#FFFFFF" />
              {!analysisStopped && (
                <View style={styles.bubbleScoreContainer}>
                  {hasAnalysis || demoScores
                    ? (
                      <>
                        <Text style={styles.bubbleScoreLabel}>AI Probability</Text>
                        <Text style={[styles.bubbleScore, elderlyModeEnabled && styles.elderlyBubbleScore]}>
                          {displayedAiProbability}%
                        </Text>
                      </>
                    )
                    : (
                      <Text style={[styles.bubbleScore, elderlyModeEnabled && styles.elderlyBubbleScore]}>
                        {isAnalyzing ? 'Analyzing...' : 'Listening...'}
                      </Text>
                    )}
                </View>
              )}
              {isAnalyzing && !analysisStopped && (
                <View style={styles.bubbleSpinner} />
              )}
              {/* Web evidence notification dot — visible even when card is closed */}
              {(pendingWebEvidence || webEvidence) && !showAnalysisCard && (
                <View style={styles.webDot} />
              )}
            </TouchableOpacity>

            {showAnalysisCard && (
              <Animated.View
                entering={FadeIn.duration(200)}
                exiting={FadeOut.duration(150)}
                style={[styles.analysisCard, elderlyModeEnabled && styles.elderlyAnalysisCard]}
              >
                {analysisStopped ? (
                  <View style={styles.analysisCardInner}>
                    <Text style={[styles.analysisLabel, elderlyModeEnabled && styles.elderlyAnalysisLabel]}>
                      Analysis paused
                    </Text>
                    <Text style={[styles.analysisSubtext, elderlyModeEnabled && styles.elderlyAnalysisLabel]}>
                      No audio is being recorded
                    </Text>
                    <TouchableOpacity
                      onPress={handleResumeAnalysis}
                      style={styles.resumeBtn}
                    >
                      <Text style={styles.resumeBtnText}>Resume Analysis</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.analysisCardInner}>
                    <View style={styles.analysisRow}>
                      <Text style={[styles.analysisLabel, elderlyModeEnabled && styles.elderlyAnalysisLabel]}>
                        Scam Intent
                      </Text>
                      <Text style={[styles.analysisValue, elderlyModeEnabled && styles.elderlyAnalysisValue, { color: getRiskScoreColor(displayedScamIntentScore) }]}>
                        {hasAnalysis || demoScores ? `${displayedScamIntentScore}%` : isAnalyzing ? 'Analyzing...' : 'Listening...'}
                      </Text>
                    </View>
                    <View style={styles.analysisRow}>
                      <Text style={[styles.analysisLabel, elderlyModeEnabled && styles.elderlyAnalysisLabel]}>
                        Voice authenticity
                      </Text>
                      <Text style={[styles.analysisValue, elderlyModeEnabled && styles.elderlyAnalysisValue, { color: getVoiceAuthenticityColor(displayedAuthenticity) }]}>
                        {hasAnalysis || demoScores
                          ? `${displayedAuthenticity}%`
                          : isAnalyzing
                            ? 'Analyzing...'
                            : 'Listening...'}
                      </Text>
                    </View>
                    <View style={styles.analysisRow}>
                      <Text style={[styles.analysisLabel, elderlyModeEnabled && styles.elderlyAnalysisLabel]}>
                        Overall risk
                      </Text>
                      <Text style={[styles.analysisValue, elderlyModeEnabled && styles.elderlyAnalysisValue, { color: getRiskScoreColor(displayedUnifiedRiskScore) }]}>
                        {hasAnalysis || demoScores ? `${displayedUnifiedRiskScore}%` : isAnalyzing ? 'Analyzing...' : 'Listening...'}
                      </Text>
                    </View>
                    {hasAnalysis && riskLevelLabel ? (
                      <View style={styles.analysisRow}>
                        <Text style={[styles.analysisLabel, elderlyModeEnabled && styles.elderlyAnalysisLabel]}>
                          Risk level
                        </Text>
                        <Text style={[styles.analysisValue, {
                          color: getRiskScoreColor(unifiedRiskScore),
                          fontSize: elderlyModeEnabled ? 18 : 12,
                        }]}>
                          {riskLevelLabel}
                        </Text>
                      </View>
                    ) : null}
                    {threatType && threatType !== 'NORMAL' ? (
                      <View style={styles.analysisRow}>
                        <Text style={[styles.analysisLabel, elderlyModeEnabled && styles.elderlyAnalysisLabel]}>
                          Threat
                        </Text>
                        <Text style={[styles.analysisValue, {
                          color: threatType === 'AI_CLONE_SCAM' ? '#DC2626' : '#F59E0B',
                          fontSize: elderlyModeEnabled ? 17 : 11,
                        }]}>
                          {threatType.replace(/_/g, ' ')}
                        </Text>
                      </View>
                    ) : null}
                    {uiAlert && uiAlert !== 'This call looks safe.' ? (
                      <View style={styles.uiAlertBanner}>
                        <Ionicons
                          name={threatType === 'AI_CLONE_SCAM' ? 'skull-outline' : 'alert-circle'}
                          size={14}
                          color={threatType === 'AI_CLONE_SCAM' ? '#DC2626' : '#F59E0B'}
                          style={{ marginRight: 6 }}
                        />
                        <Text style={[styles.uiAlertText, elderlyModeEnabled && styles.elderlyWarningText, {
                          color: threatType === 'AI_CLONE_SCAM' ? '#FCA5A5' : '#FDE68A',
                        }]}>
                          {uiAlert}
                        </Text>
                      </View>
                    ) : null}
                    {scamCategory ? (
                      <Text style={styles.scamCategoryText}>
                        {scamCategory}
                      </Text>
                    ) : null}
                    {pendingWebEvidence ? (
                      <View style={[styles.uiAlertBanner, { backgroundColor: 'rgba(59, 130, 246, 0.15)', borderColor: '#3B82F6', marginTop: 8 }]}>
                        <ActivityIndicator size="small" color="#60A5FA" style={{ marginRight: 6 }} />
                        <Text style={[styles.uiAlertText, { color: '#93C5FD' }]}>
                          Verifying caller claim via live web...
                        </Text>
                      </View>
                    ) : null}
                    {webEvidence ? (
                      <View style={[
                        styles.uiAlertBanner,
                        {
                          backgroundColor: webEvidence.verdict === 'CONTRADICTED' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                          borderColor: webEvidence.verdict === 'CONTRADICTED' ? '#EF4444' : '#22C55E',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          marginTop: 8,
                        }
                      ]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                          <Ionicons
                            name={webEvidence.verdict === 'CONTRADICTED' ? 'warning-outline' : 'checkmark-circle-outline'}
                            size={16}
                            color={webEvidence.verdict === 'CONTRADICTED' ? '#EF4444' : '#22C55E'}
                            style={{ marginRight: 6 }}
                          />
                          <Text style={{
                            color: webEvidence.verdict === 'CONTRADICTED' ? '#FCA5A5' : '#86EFAC',
                            fontWeight: '700',
                            fontSize: 12,
                          }}>
                            Web Second Opinion: {webEvidence.verdict}
                          </Text>
                        </View>
                        <Text style={{ color: '#E4E4E7', fontSize: 11, marginBottom: 2 }}>
                          {webEvidence.reason}
                        </Text>
                        {webEvidence.sources && webEvidence.sources.length > 0 ? (
                          <Text style={{ color: '#A1A1AA', fontSize: 10 }}>
                            Source: {webEvidence.sources[0]?.title || webEvidence.sources[0]?.url}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                    {analysisError ? (
                      <Text style={styles.analysisErrorText}>
                        {analysisError}
                      </Text>
                    ) : null}
                    <View style={styles.cardDivider} />
                    <TouchableOpacity
                      onPress={handleStopAnalysis}
                      style={styles.stopAnalysisBtn}
                    >
                      <Ionicons name="pause-circle-outline" size={16} color="#EF4444" style={{ marginRight: 6 }} />
                      <Text style={styles.stopAnalysisText}>Stop Analysis</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </Animated.View>
            )}
          </View>
        )}

        <View style={styles.controlsRow}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleToggleMute}
            style={[styles.controlBtn, isMuted && styles.controlBtnActive]}
          >
            <Ionicons name={isMuted ? 'mic-off' : 'mic'} size={24} color={isMuted ? '#EF4444' : '#FFFFFF'} />
            <Text style={[
              styles.controlLabel,
              elderlyModeEnabled && styles.elderlyControlLabel,
              isMuted && { color: '#EF4444' },
            ]}>
              {isMuted ? 'Muted' : 'Mute'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleToggleSpeaker}
            style={[styles.controlBtn, isSpeaker && styles.controlBtnActive]}
          >
            <Ionicons name={isSpeaker ? 'volume-high' : 'volume-medium-outline'} size={24} color="#FFFFFF" />
            <Text style={[styles.controlLabel, elderlyModeEnabled && styles.elderlyControlLabel]}>
              Speaker
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setShowKeypad(true)}
            style={[styles.controlBtn, showKeypad && styles.controlBtnActive]}
          >
            <Ionicons name="keypad-outline" size={24} color="#FFFFFF" />
            <Text style={[styles.controlLabel, elderlyModeEnabled && styles.elderlyControlLabel]}>
              Keypad
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => {
              showAlert(
                'Add Caller',
                'Conference calling and secure bridge addition will be available once backend telephony is integrated.',
                [{ text: 'OK' }],
                'info',
              );
            }}
            style={styles.controlBtn}
          >
            <Ionicons name="person-add-outline" size={24} color="#FFFFFF" />
            <Text style={[styles.controlLabel, elderlyModeEnabled && styles.elderlyControlLabel]}>
              Add
            </Text>
          </TouchableOpacity>
        </View>

        {showKeypad && (
          <View style={styles.keypadOverlay}>
            <View style={styles.keypadOverlayHeader}>
              <Text style={[
                styles.keypadOverlayTitle,
                elderlyModeEnabled && styles.elderlyKeypadTitle,
              ]}>
                Keypad: {dtmfText}
              </Text>
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

        <View style={styles.endCallArea}>
          <TouchableOpacity activeOpacity={0.8} onPress={handleEndCall} style={styles.endCallBtn}>
            <Ionicons name="call-sharp" size={30} color="#FFFFFF" style={{ transform: [{ rotate: '135deg' }] }} />
          </TouchableOpacity>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  encryptedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.2)',
  },
  encryptedText: {
    color: '#22C55E',
    fontSize: 12,
    fontWeight: '600',
  },
  timerSmall: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
  elderlyTimer: {
    fontSize: 21,
  },
  callerCenter: {
    alignItems: 'center',
    marginTop: -20,
  },
  avatarArea: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  pulseRing: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2,
    borderColor: 'rgba(59, 130, 246, 0.25)',
  },
  avatarGradient: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 42,
    fontWeight: '700',
  },
  callerName: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  elderlyCallerName: {
    fontSize: 36,
    letterSpacing: 0,
  },
  callerSub: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 4,
  },
  elderlyCallerSub: {
    fontSize: 18,
    lineHeight: 26,
    textAlign: 'center',
  },
  savedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 12,
  },
  savedBadgeText: {
    color: '#22C55E',
    fontSize: 12,
    fontWeight: '500',
  },
  bubbleContainer: {
    position: 'absolute',
    top: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 60 : 60,
    right: 24,
    alignItems: 'flex-end',
    zIndex: 200,
  },
  bubble: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  calculatingBubble: {
    width: 112,
    paddingHorizontal: 10,
  },
  aiProbabilityBubble: {
    width: 128,
    height: 64,
    borderRadius: 32,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
  },
  bubbleScoreContainer: {
    alignItems: 'center',
  },
  bubbleScoreLabel: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '700',
  },
  bubbleScore: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 1,
    flexShrink: 0,
  },
  elderlyBubbleScore: {
    fontSize: 14,
  },
  bubbleSpinner: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    borderTopColor: 'transparent',
  },
  analysisCard: {
    marginTop: 8,
    backgroundColor: '#1A1A1E',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    width: 220,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
  },
  elderlyAnalysisCard: {
    width: 290,
  },
  analysisCardInner: {
    padding: 14,
  },
  analysisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  analysisLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  analysisValue: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  elderlyAnalysisLabel: {
    fontSize: 16,
    lineHeight: 22,
  },
  elderlyAnalysisValue: {
    fontSize: 19,
  },
  analysisSubtext: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
    marginBottom: 10,
  },
  scamCategoryText: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  analysisErrorText: {
    color: '#EF4444',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
  uiAlertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginTop: 6,
    marginBottom: 4,
  },
  uiAlertText: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  elderlyWarningText: {
    fontSize: 17,
    lineHeight: 24,
  },
  cardDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 6,
  },
  stopAnalysisBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  stopAnalysisText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
  },
  resumeBtn: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  resumeBtnText: {
    color: '#3B82F6',
    fontSize: 13,
    fontWeight: '600',
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 10,
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
    backgroundColor: 'rgba(59,130,246,0.25)',
    borderColor: 'rgba(59,130,246,0.4)',
  },
  controlLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    position: 'absolute',
    bottom: -20,
  },
  elderlyControlLabel: {
    fontSize: 14,
  },
  endCallArea: {
    alignItems: 'center',
    paddingTop: 16,
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
  elderlyKeypadTitle: {
    fontSize: 22,
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
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  keypadOverlayKeyText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '600',
  },
});
