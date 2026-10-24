import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FloatingCallButton from '../../components/buttons/FloatingCallButton';
import { ROUTES } from '../../constants/routes';
import { colors } from '../../theme';
import { safeGoBack } from '../../utils/navigationHelper';
import { analysisService } from '../../services/analysis/analysisService';
import { showAlert } from '../../store/alertStore';
import { getRiskScoreBackground, getRiskScoreColor } from '../../utils/scoreColors';

export default function CallDetailsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const call = route.params?.call || {};

  const callerNumber = call.callerNumber || call.caller_number || call.number || '';
  const isSavedContact = call.isSavedContact === true;
  const hasAnalysis = !isSavedContact && call.analysisAvailable !== false;
  const riskEvents = call.riskEvents || call.flaggedKeywords?.map((k, i) => ({
    id: `kw-${i}`,
    time: '--:--',
    label: k,
    type: (call.unifiedRiskScore || call.unified_risk_score || 0) >= 70 ? 'danger' : 'warning',
  })) || [];
  const aiExplanation = call.aiExplanation || call.reasoning || '';
  const authenticityScore = call.authenticityScore ?? (call.ai_voice_probability != null ? Math.max(0, 100 - Math.round(call.ai_voice_probability)) : '--');
  const aiProbability = call.aiProbability ?? Math.round(call.ai_voice_probability ?? 0);
  const unifiedRiskScore = call.unifiedRiskScore ?? Math.round(call.unified_risk_score ?? 0);
  const riskLevelLabel = hasAnalysis ? (call.riskLevelLabel || call.risk_level || 'LOW RISK') : 'ANALYSIS UNAVAILABLE';
  const scamCategory = call.scamCategory || call.scam_category || '';
  const callTime = call.time || '--:--';
  const callDuration = call.duration || '--';
  const callName = call.name || call.callerNumber || call.number || 'Unknown Caller';
  const initials = call.initials || (call.callerNumber || call.number || 'UC').replace(/\D/g, '').slice(-2) || 'UC';
  const rawTranscript = call.transcriptLines || call.transcript || [];
  const transcriptLines = Array.isArray(rawTranscript)
    ? rawTranscript
    : typeof rawTranscript === 'string' && rawTranscript.trim()
      ? rawTranscript.split('\n').filter(Boolean).map((text, idx) => ({ id: `line-${idx}`, time: '--:--', text: text.trim() }))
      : [];

  const [spamStatus, setSpamStatus] = useState(null);
  const [spamLoading, setSpamLoading] = useState(false);
  const [reportingSpam, setReportingSpam] = useState(false);

  const loadSpamStatus = useCallback(async () => {
    if (!callerNumber) return;
    setSpamLoading(true);
    try {
      const status = await analysisService.checkSpamStatus(callerNumber);
      setSpamStatus(status);
    } catch (err) {
      console.warn('Spam status failed:', err.message);
    } finally {
      setSpamLoading(false);
    }
  }, [callerNumber]);

  useEffect(() => {
    loadSpamStatus();
  }, [loadSpamStatus]);

  const handleReportScam = () => {
    showAlert(
      'Report as Spam',
      `Report ${callerNumber || 'this number'} as spam to TruVoice threat intelligence?\n\nThis will flag the number for other users.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: async () => {
            setReportingSpam(true);
            try {
              const result = await analysisService.reportSpam(callerNumber);
              setSpamStatus(result);
              showAlert(
                'Reported',
                `Spam report recorded.\nReport count: ${result.report_count}\nMarked spam: ${result.is_spam ? 'Yes' : 'Not yet (needs 20 reports)'}`,
                [],
                'success',
              );
            } catch (err) {
              showAlert('Report failed', err.message || 'Could not submit spam report.', [], 'danger');
            } finally {
              setReportingSpam(false);
            }
          },
        },
      ],
      'warning',
    );
  };

  const handleFileComplaint = () => {
    navigation.navigate(ROUTES.REPORT_SCAM, {
      phone_number: callerNumber,
      call_id: call.id,
      call_summary: {
        scamCategory,
        riskLevelLabel,
        unifiedRiskScore,
        aiExplanation,
      },
    });
  };

  const handleBlockCaller = () => {
    showAlert(
      'Block Caller',
      'Are you sure you want to block this caller? Future calls from this number will be automatically declined.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => showAlert('Blocked', 'Caller has been added to your block list.', [], 'success'),
        },
      ],
      'danger',
    );
  };

  const isMissed = call.filterCategory === 'Missed' || scamCategory === 'Missed Call' || scamCategory === 'Missed' || scamCategory === 'Not Answered';
  const missedLabel = call.badge || (scamCategory === 'Not Answered' ? 'NOT ANSWERED' : 'MISSED');
  const missedColor = call.badgeColor || '#71717A';

  const getRiskColor = () => {
    if (!hasAnalysis) return colors.textMuted;
    if (isMissed) return missedColor;
    return getRiskScoreColor(unifiedRiskScore);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>Call details</Text>
            <Text style={styles.headerSub}>{callTime} · {callDuration}</Text>
          </View>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom + 110, 120) },
          ]}
        >
          <View style={styles.callerHeader}>
            <View style={[styles.callerAvatar, { borderColor: getRiskColor() }]}>
              <Text style={styles.callerAvatarText}>{initials}</Text>
            </View>
            <Text style={styles.callerName}>{callName}</Text>
            {callerNumber ? <Text style={styles.callerNumber}>{callerNumber}</Text> : null}
            <View style={[styles.riskBadge, { backgroundColor: `${getRiskColor()}22`, borderColor: `${getRiskColor()}55` }]}>
              <Ionicons
                name={isMissed ? 'call-outline' : (!hasAnalysis ? 'information-circle-outline' : (unifiedRiskScore >= 80 ? 'warning' : unifiedRiskScore >= 50 ? 'alert-circle' : 'shield-checkmark'))}
                size={14}
                color={getRiskColor()}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.riskBadgeText, { color: getRiskColor() }]}>{isMissed ? missedLabel.toUpperCase() : riskLevelLabel}</Text>
            </View>

            {spamLoading ? (
              <View style={styles.spamRow}>
                <ActivityIndicator size="small" color={colors.textMuted} />
              </View>
            ) : spamStatus ? (
              <View style={styles.spamRow}>
                <Ionicons
                  name={spamStatus.is_spam ? 'alert-circle' : 'shield-checkmark-outline'}
                  size={14}
                  color={spamStatus.is_spam ? '#EF4444' : '#22C55E'}
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.spamText, { color: spamStatus.is_spam ? '#EF4444' : '#22C55E' }]}>
                  {spamStatus.is_spam ? 'Marked as spam by community' : `Community reports: ${spamStatus.report_count}`}
                </Text>
              </View>
            ) : null}
          </View>

          {!isMissed && hasAnalysis && (
            <>
              <View style={styles.gaugeSection}>
                <View style={[styles.gaugeCircle, {
                  borderColor: getRiskColor(),
                  borderTopColor: 'rgba(255,255,255,0.1)',
                  borderRightColor: 'rgba(255,255,255,0.1)',
                }]}>
                  <Text style={[styles.gaugeLabel, { color: getRiskColor() }]}>TRUST SCORE</Text>
                  <Text style={[styles.gaugeValue, { color: getRiskColor() }]}>
                    {typeof authenticityScore === 'number' ? `${authenticityScore}%` : authenticityScore}
                  </Text>
                  <Text style={[styles.gaugeSub, { color: getRiskColor() }]}>
                    {typeof authenticityScore === 'number' && authenticityScore < 40
                      ? 'AI Detected'
                      : typeof authenticityScore === 'number' && authenticityScore < 70
                        ? 'Suspicious'
                        : 'Likely Human'}
                  </Text>
                </View>
              </View>

              <View style={styles.metricsRow}>
                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>AI PROBABILITY</Text>
                  <Text style={[styles.metricValue, { color: getRiskScoreColor(aiProbability) }]}>
                    {aiProbability}%
                  </Text>
                </View>
                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>RISK SCORE</Text>
                  <Text style={[styles.metricValue, { color: getRiskColor() }]}>
                    {unifiedRiskScore}%
                  </Text>
                </View>
              </View>
            </>
          )}

          {isMissed || (hasAnalysis && scamCategory) ? (
            <View
              style={[
                styles.categoryCard,
                {
                  backgroundColor: isMissed ? `${missedColor}14` : getRiskScoreBackground(unifiedRiskScore),
                  borderColor: isMissed ? `${missedColor}33` : getRiskScoreBackground(unifiedRiskScore, 0.2),
                }
              ]}
            >
              <Ionicons
                name={isMissed ? 'call-outline' : (scamCategory === 'Standard Call' ? 'shield-checkmark-outline' : 'alert')}
                size={18}
                color={isMissed ? missedColor : getRiskScoreColor(unifiedRiskScore)}
                style={{ marginRight: 8 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.categoryLabel}>
                  {isMissed ? 'Call Status' : (scamCategory === 'Standard Call' ? 'Call Verification Status' : 'Detected Scam Category')}
                </Text>
                <Text
                  style={[
                    styles.categoryValue,
                    { color: isMissed ? missedColor : getRiskScoreColor(unifiedRiskScore) }
                  ]}
                >
                  {isMissed ? missedLabel : (scamCategory === 'Standard Call' ? 'Secure Call (No Scam Detected)' : scamCategory)}
                </Text>
              </View>
            </View>
          ) : null}

          {!hasAnalysis && !isMissed ? (
            <>
              <Text style={styles.sectionTitle}>Call analysis</Text>
              <View style={styles.card}>
                <Text style={styles.explanationText}>
                  Voice analysis is not available for saved contacts. No authenticity, AI probability, risk score, or transcript was generated for this call.
                </Text>
              </View>
            </>
          ) : isMissed ? (
            <>
              <Text style={styles.sectionTitle}>Call Details</Text>
              <View style={styles.card}>
                <Text style={styles.explanationText}>
                  No real-time voice analysis, risk scoring, keyword warnings, or call transcripts are available for this record. The call was missed, declined, or canceled before it could connect to the secure TruVoice RTC audio channel.
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.sectionTitle}>Risk events</Text>
              <View style={styles.card}>
                {riskEvents.length > 0 ? riskEvents.map((event) => (
                  <TouchableOpacity
                    key={event.id || event.label}
                    activeOpacity={0.7}
                    onPress={() =>
                      showAlert(event.label, `Severity: ${event.type === 'danger' ? 'High — confirmed synthetic/suspicious' : 'Medium — anomalous'}`, [], event.type === 'danger' ? 'danger' : 'warning')
                    }
                    style={styles.eventRow}
                  >
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: event.type === 'danger' ? '#EF4444' : '#F59E0B' },
                      ]}
                    />
                    <Text style={styles.eventTime}>{event.time || '--:--'}</Text>
                    <Text style={styles.eventLabel}>{event.label}</Text>
                  </TouchableOpacity>
                )) : (
                  <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: 'center' }}>No risk events detected</Text>
                )}
              </View>

              {Array.isArray(transcriptLines) && transcriptLines.length > 0 ? (
                <>
                  <Text style={styles.sectionTitle}>Transcript</Text>
                  <View style={styles.card}>
                    {transcriptLines.map((line, idx) => (
                      <View key={line.id || idx} style={{ flexDirection: 'row', marginVertical: 4 }}>
                        <Text style={styles.tsTime}>{typeof line === 'object' && line.time ? line.time : '--:--'}</Text>
                        <Text style={styles.tsText}>{typeof line === 'object' ? (line.text || line.line || '') : String(line)}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}

              <Text style={styles.sectionTitle}>AI explanation</Text>
              <View style={styles.card}>
                <Text style={styles.explanationText}>
                  {aiExplanation || 'AI analysis explanation is not available for this call.'}
                </Text>
              </View>
            </>
          )}

          <View style={styles.actionsRow}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleBlockCaller}
              style={styles.actionBtn}
            >
              <Ionicons name="ban-outline" size={18} color="#EF4444" style={{ marginRight: 6 }} />
              <Text style={styles.actionBtnText}>Block caller</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleReportScam}
              disabled={reportingSpam}
              style={[styles.actionBtn, reportingSpam && { opacity: 0.6 }]}
            >
              {reportingSpam ? (
                <ActivityIndicator size="small" color="#F59E0B" style={{ marginRight: 6 }} />
              ) : (
                <Ionicons name="flag-outline" size={18} color="#F59E0B" style={{ marginRight: 6 }} />
              )}
              <Text style={[styles.actionBtnText, { color: '#F59E0B' }]}>Report spam</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleFileComplaint}
            style={styles.complaintBtn}
          >
            <Ionicons name="document-text-outline" size={18} color="#3B82F6" style={{ marginRight: 8 }} />
            <Text style={styles.complaintBtnText}>File scam complaint</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
        </ScrollView>

        <FloatingCallButton onPress={() => navigation.navigate(ROUTES.KEYPAD)} />

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
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  headerSub: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  scrollContent: {},
  callerHeader: {
    alignItems: 'center',
    paddingVertical: 16,
    marginBottom: 8,
  },
  callerAvatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#18181B',
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  callerAvatarText: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '700',
  },
  callerName: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  callerNumber: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 2,
  },
  riskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 12,
  },
  riskBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  spamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  spamText: {
    fontSize: 12,
    fontWeight: '500',
  },
  gaugeSection: {
    alignItems: 'center',
    marginVertical: 12,
  },
  gaugeCircle: {
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gaugeLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  gaugeValue: {
    fontSize: 44,
    fontWeight: '800',
    marginVertical: 2,
  },
  gaugeSub: {
    fontSize: 13,
    fontWeight: '600',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 12,
    marginVertical: 8,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#131316',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  metricValue: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    marginTop: 6,
  },
  categoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.25)',
    marginVertical: 10,
  },
  categoryLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  categoryValue: {
    color: '#F59E0B',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 10,
  },
  card: {
    backgroundColor: '#131316',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    gap: 14,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 14,
  },
  eventTime: {
    color: colors.textMuted,
    fontSize: 13,
    width: 50,
  },
  eventLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  tsTime: {
    color: colors.textMuted,
    fontSize: 12,
    width: 50,
  },
  tsText: {
    color: '#FFFFFF',
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  explanationText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 22,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#131316',
    borderRadius: 18,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  actionBtnText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
  },
  complaintBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131316',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginTop: 12,
  },
  complaintBtnText: {
    color: '#3B82F6',
    fontSize: 14,
    fontWeight: '600',
  },
});
