import React, { useMemo } from 'react';
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
} from 'react-native';
import { Clipboard } from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { ROUTES } from '../../constants/routes';
import { normalizeAnalysis } from '../../utils/analysisMapper';
import { colors } from '../../theme';
import { getRiskScoreBackground, getRiskScoreColor } from '../../utils/scoreColors';
import { showAlert } from '../../store/alertStore';

const pickEither = (obj, camelKey, snakeKey, fallback = undefined) => {
  if (obj == null) return fallback;
  const camel = obj[camelKey];
  const snake = obj[snakeKey];
  if (camel !== undefined && camel !== null) return camel;
  if (snake !== undefined && snake !== null) return snake;
  return fallback;
};

export default function CallSummaryScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const contact = route.params?.contact || {
    name: 'Unknown Caller',
    number: '',
    initials: 'UC',
  };
  const isSavedContact = route.params?.isSavedContact || false;
  const callDuration = route.params?.duration || '--';
  const rawTranscript = route.params?.transcript || [];
  const lastAnalysisRaw = route.params?.lastAnalysis || null;
  const analysisChunks = route.params?.analysisChunks || [];

  const averagedAnalysis = useMemo(() => {
    if (!analysisChunks.length) return null;

    const chunks = analysisChunks.map((chunk) => normalizeAnalysis(chunk));
    const average = (key) =>
      Math.round(chunks.reduce((total, chunk) => total + Number(chunk[key] || 0), 0) / chunks.length);

    return {
      aiProbability: average('aiProbability'),
      scamIntentScore: average('scamIntentScore'),
      unifiedRiskScore: average('unifiedRiskScore'),
    };
  }, [analysisChunks]);

  const analysis = useMemo(
    () => (lastAnalysisRaw ? normalizeAnalysis(lastAnalysisRaw) : null),
    [lastAnalysisRaw],
  );

  const aiProbability = averagedAnalysis?.aiProbability ?? pickEither(analysis, 'aiProbability', 'ai_voice_probability', 0);
  const aiProbabilityCategory = useMemo(() => {
    if (aiProbability < 50) return { label: 'Low', color: '#22C55E' };
    if (aiProbability < 70) return { label: 'Medium', color: '#F59E0B' };
    if (aiProbability < 85) return { label: 'High', color: '#F97316' };
    return { label: 'Critical', color: '#EF4444' };
  }, [aiProbability]);
  const authenticityScore = pickEither(
    analysis,
    'authenticityScore',
    null,
    aiProbability != null ? Math.max(0, 100 - aiProbability) : 100,
  );
  const unifiedRiskScore = averagedAnalysis?.unifiedRiskScore ?? pickEither(analysis, 'unifiedRiskScore', 'unified_risk_score', 0);
  const scamIntentScore = averagedAnalysis?.scamIntentScore ?? pickEither(analysis, 'scamIntentScore', 'scam_intent_score', 0);
  const riskLevelLabel = pickEither(
    analysis,
    'riskLevelLabel',
    'risk_level',
    unifiedRiskScore > 60 ? 'SEVERE' : unifiedRiskScore > 30 ? 'MODERATE' : 'SAFE',
  );
  const threatType = pickEither(analysis, 'threatType', 'threat_type', 'NORMAL') || 'NORMAL';
  const uiAlert = pickEither(analysis, 'uiAlert', 'ui_alert', 'This call looks safe.') || 'This call looks safe.';
  const scamCategory = pickEither(analysis, 'scamCategory', 'scam_category', '');
  const reasoning = pickEither(analysis, 'reasoning', 'reasoning', '');
  const flaggedKeywords = pickEither(
    analysis,
    'flaggedKeywords',
    'flagged_keywords',
    [],
  ) || [];

  const transcriptLines = useMemo(() => {
    let lines = [];
    if (Array.isArray(rawTranscript) && rawTranscript.length > 0) {
      lines = rawTranscript;
    } else if (analysis?.transcriptLines?.length) {
      lines = analysis.transcriptLines;
    }
    const hallucinations = [
      'thank you',
      'thank you.',
      'thank you!',
      'thank you for watching',
      'thank you for listening',
      'subtitles by amara.org',
      'subtitles by',
      'amara.org',
    ];
    return lines.filter((line) => {
      if (!line) return false;
      const clean = String(line).toLowerCase().trim();
      return !hallucinations.includes(clean) && clean.length > 1;
    });
  }, [rawTranscript, analysis]);

  const hasAnalysis =
    !isSavedContact &&
    (lastAnalysisRaw ||
      (typeof unifiedRiskScore === 'number' && unifiedRiskScore > 0) ||
      (typeof aiProbability === 'number' && aiProbability > 0));

  const riskColor = () => {
    if (!hasAnalysis) return '#22C55E';
    return getRiskScoreColor(unifiedRiskScore);
  };

  const badgeLabel = () => {
    if (isSavedContact) return { label: 'Saved contact', color: '#22C55E' };
    if (!hasAnalysis) return { label: 'No analysis', color: colors.textMuted };
    if (aiProbability > 60) return { label: 'Synthetic voice', color: getRiskScoreColor(aiProbability) };
    if (aiProbability > 30 || unifiedRiskScore > 50) {
      return { label: 'Suspicious', color: getRiskScoreColor(Math.max(aiProbability, unifiedRiskScore)) };
    }
    return { label: 'Verified human', color: getRiskScoreColor(Math.max(aiProbability, unifiedRiskScore)) };
  };

  const badge = badgeLabel();

  const handleCopyTranscript = async () => {
    if (transcriptLines.length === 0) {
      showAlert('No Transcript', 'Transcript data is not yet available for this call.', [], 'info');
      return;
    }
    const transcriptText = transcriptLines
      .map((line) => `[${line.time || '--:--'}] ${line.text || line}`)
      .join('\n');
    try {
      await Clipboard.setStringAsync(transcriptText);
      showAlert('Copied', 'Full transcript copied to clipboard.', [], 'success');
    } catch {
      showAlert('Transcript', transcriptText, [], 'info');
    }
  };

  const handleViewDetails = () => {
    const callPayload = {
      id: pickEither(analysis, 'id', null) || `temp-${Date.now()}`,
      callerNumber: contact.number || contact.phone_number || '',
      caller_number: contact.number || contact.phone_number || '',
      number: contact.number || contact.phone_number || '',
      name: contact.name || 'Unknown Caller',
      initials: contact.initials || 'UC',
      isSavedContact,
      analysisAvailable: Boolean(hasAnalysis),
      time: '--:--',
      duration: callDuration,
      authenticityScore,
      aiProbability,
      ai_voice_probability: aiProbability,
      unifiedRiskScore,
      unified_risk_score: unifiedRiskScore,
      scamIntentScore,
      scam_intent_score: scamIntentScore,
      riskLevelLabel,
      risk_level: riskLevelLabel,
      scamCategory,
      scam_category: scamCategory,
      flaggedKeywords,
      flagged_keywords: flaggedKeywords,
      reasoning,
      aiExplanation: reasoning,
      threatType,
      threat_type: threatType,
      uiAlert,
      ui_alert: uiAlert,
      transcript: transcriptLines,
      transcriptLines,
      riskEvents: flaggedKeywords.map((k, i) => ({
        id: `kw-${i}`,
        time: '--:--',
        label: k,
        type: unifiedRiskScore >= 70 ? 'danger' : 'warning',
      })),
    };
    navigation.navigate(ROUTES.CALL_DETAILS, { call: callPayload });
  };

  const renderChartPath = () => {
    const score = hasAnalysis ? unifiedRiskScore : 20;
    const peaks = Math.max(3, Math.round(score / 20));
    const startY = 90;
    const minY = Math.max(10, startY - score * 0.7);
    let d = `M 10,${startY}`;
    const step = 280 / Math.max(peaks, 4);
    for (let i = 1; i <= peaks; i++) {
      const x = 10 + i * step;
      const y = i % 2 === 1 ? minY + (i * 3) % 20 : startY - ((i * 7) % 15);
      const prevX = 10 + (i - 1) * step;
      const qx = (prevX + x) / 2;
      const qy = i % 2 === 1 ? minY - 5 : startY + 5;
      d += ` Q ${qx},${qy} ${x},${Math.min(Math.max(y, 10), startY)}`;
    }
    const finalX = 290;
    d += ` T ${finalX},${Math.min(Math.max(startY - (score * 0.3), 20), startY)}`;
    const fillPath = `${d} L ${finalX},100 L 10,100 Z`;
    return { line: d, fill: fillPath };
  };

  const chartPath = renderChartPath();
  const chartColor = riskColor();

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.reset({ index: 0, routes: [{ name: ROUTES.MAIN_TABS }] })}
            style={styles.backBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Call summary</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom + 40, 50) },
          ]}
        >
          <View style={styles.summaryCard}>
            <LinearGradient
              colors={contact.colors || ['#EF4444', '#3B82F6']}
              style={styles.avatar}
            >
              <Text style={styles.avatarText}>{contact.initials || 'UC'}</Text>
            </LinearGradient>

            <Text style={styles.callerName}>{contact.name || 'Unknown Caller'}</Text>
            <Text style={styles.callMeta}>{callDuration}</Text>

            <View
              style={[
                styles.syntheticBadge,
                { backgroundColor: `${badge.color}26`, borderColor: `${badge.color}55` },
              ]}
            >
              <Text style={[styles.syntheticText, { color: badge.color }]}>
                {badge.label}
              </Text>
            </View>

            {scamCategory ? (
              <View
                style={[
                  styles.categoryBadge,
                  {
                    backgroundColor: getRiskScoreBackground(unifiedRiskScore),
                    borderColor: getRiskScoreBackground(unifiedRiskScore, 0.2),
                  }
                ]}
              >
                <Ionicons
                  name={scamCategory === 'Standard Call' ? 'shield-checkmark' : 'alert'}
                  size={12}
                  color={getRiskScoreColor(unifiedRiskScore)}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[
                    styles.categoryBadgeText,
                    { color: getRiskScoreColor(unifiedRiskScore) }
                  ]}
                >
                  {scamCategory === 'Standard Call' ? 'Secure Connection' : scamCategory}
                </Text>
              </View>
            ) : null}
          </View>

          {hasAnalysis ? (
            <View style={styles.metricsRow}>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>SCAM INTENT</Text>
                <Text style={[styles.metricValue, { color: getRiskScoreColor(scamIntentScore) }]}>
                  {`${scamIntentScore}%`}
                </Text>
              </View>

              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>AI PROB.</Text>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={[styles.metricValue, styles.aiProbabilityValue, { color: aiProbabilityCategory.color }]}
                >
                  {aiProbabilityCategory.label}
                </Text>
                <Text style={styles.metricSubvalue}>{`${aiProbability}%`}</Text>
              </View>

              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>RISK</Text>
                <Text style={[styles.metricValue, { color: riskColor() }]}>
                  {`${unifiedRiskScore}%`}
                </Text>
              </View>
            </View>
          ) : (
            <View style={[styles.metricsRow, { opacity: 0.6 }]}>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>SCAM INTENT</Text>
                <Text style={[styles.metricValue, { color: colors.textMuted }]}>
                  {isSavedContact ? 'N/A' : '--'}
                </Text>
              </View>

              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>AI PROB.</Text>
                <Text style={[styles.metricValue, { color: colors.textMuted }]}>
                  {isSavedContact ? 'N/A' : '--'}
                </Text>
              </View>

              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>RISK</Text>
                <Text style={[styles.metricValue, { color: colors.textMuted }]}>
                  {isSavedContact ? 'N/A' : '--'}
                </Text>
              </View>
            </View>
          )}

          {hasAnalysis ? (
            <>
              <View style={styles.riskLevelRow}>
                <Ionicons
                  name={
                    unifiedRiskScore >= 80
                      ? 'warning'
                      : unifiedRiskScore >= 50
                        ? 'alert-circle'
                        : 'shield-checkmark'
                  }
                  size={16}
                  color={riskColor()}
                  style={{ marginRight: 8 }}
                />
                <Text style={[styles.riskLevelLabel, { color: riskColor() }]}>
                  {String(riskLevelLabel).toUpperCase()}
                </Text>
              </View>

              {uiAlert && uiAlert !== 'This call looks safe.' ? (
                <View style={[styles.uiAlertBanner, {
                  backgroundColor: threatType === 'AI_CLONE_SCAM' ? 'rgba(220, 38, 38, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                  borderColor: threatType === 'AI_CLONE_SCAM' ? 'rgba(220, 38, 38, 0.3)' : 'rgba(245, 158, 11, 0.3)',
                }]}>
                  <Ionicons
                    name={threatType === 'AI_CLONE_SCAM' ? 'skull-outline' : 'alert-circle'}
                    size={16}
                    color={threatType === 'AI_CLONE_SCAM' ? '#FCA5A5' : '#FDE68A'}
                    style={{ marginRight: 8 }}
                  />
                  <Text style={[styles.uiAlertText, {
                    color: threatType === 'AI_CLONE_SCAM' ? '#FCA5A5' : '#FDE68A',
                  }]}>
                    {uiAlert}
                  </Text>
                </View>
              ) : null}

              <Text style={styles.sectionTitle}>Risk timeline</Text>
              <View style={styles.chartCard}>
                <Svg height="100" width="100%" viewBox="0 0 300 100">
                  <Defs>
                    <SvgGradient id="sumGrad" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor={chartColor} stopOpacity="0.45" />
                      <Stop offset="1" stopColor={chartColor} stopOpacity="0.0" />
                    </SvgGradient>
                  </Defs>
                  <Path d={chartPath.fill} fill="url(#sumGrad)" />
                  <Path
                    d={chartPath.line}
                    fill="none"
                    stroke={chartColor}
                    strokeWidth="3"
                  />
                </Svg>
              </View>
            </>
          ) : null}

          {flaggedKeywords && flaggedKeywords.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Flagged keywords</Text>
              <View style={styles.keywordsWrap}>
                {flaggedKeywords.map((k, i) => (
                  <View key={`${k}-${i}`} style={styles.keywordChip}>
                    <Ionicons name="flag" size={12} color="#F59E0B" style={{ marginRight: 6 }} />
                    <Text style={styles.keywordText}>{k}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          <View style={styles.transcriptHeader}>
            <Text style={styles.sectionTitle}>Transcript</Text>
            <TouchableOpacity activeOpacity={0.7} onPress={handleCopyTranscript}>
              <Text style={styles.copyText}>Copy</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.transcriptCard}>
            {transcriptLines.length > 0 ? (
              transcriptLines.map((line, idx) => (
                <View key={idx} style={styles.tsRow}>
                  <Text style={styles.tsTime}>{line.time || '--:--'}</Text>
                  <Text style={styles.tsText}>{line.text || String(line)}</Text>
                </View>
              ))
            ) : (
              <Text
                style={{
                  color: colors.textMuted,
                  fontSize: 13,
                  textAlign: 'center',
                  lineHeight: 20,
                }}
              >
                {isSavedContact
                  ? 'Transcript is not recorded for saved contacts by default.'
                  : 'Transcript will appear once speech-to-text is available for this call.'}
              </Text>
            )}
          </View>

          {reasoning ? (
            <>
              <Text style={styles.sectionTitle}>Why this rating</Text>
              <View style={styles.reasoningCard}>
                <Ionicons
                  name="information-circle-outline"
                  size={18}
                  color={riskColor()}
                  style={{ marginRight: 10, marginTop: 1 }}
                />
                <Text style={styles.reasoningText}>{reasoning}</Text>
              </View>
            </>
          ) : null}
        </ScrollView>

        <View style={[styles.footerRow, { paddingBottom: Math.max(insets.bottom + 16, 20) }]}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => navigation.reset({ index: 0, routes: [{ name: ROUTES.MAIN_TABS }] })}
            style={styles.secondaryBtn}
          >
            <Ionicons name="home-outline" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={styles.secondaryBtnText}>Home</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleViewDetails}
            style={[styles.primaryBtn, { backgroundColor: hasAnalysis ? riskColor() : '#3B82F6' }]}
          >
            <Text style={styles.primaryBtnText}>View full details</Text>
            <Ionicons name="arrow-forward" size={16} color="#FFFFFF" style={{ marginLeft: 8 }} />
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
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  scrollContent: {},
  summaryCard: {
    backgroundColor: '#131316',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginVertical: 12,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  callerName: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  callMeta: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  syntheticBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    marginTop: 12,
    borderWidth: 1,
  },
  syntheticText: {
    fontSize: 12,
    fontWeight: '700',
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.25)',
  },
  categoryBadgeText: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '600',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
    marginVertical: 8,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#131316',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  metricValue: {
    fontSize: 26,
    fontWeight: '800',
    marginTop: 6,
  },
  metricSubvalue: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  aiProbabilityValue: {
    fontSize: 20,
    flexShrink: 1,
  },
  riskLevelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 2,
  },
  riskLevelLabel: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
  },
  scamIntentPill: {
    marginLeft: 'auto',
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  uiAlertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
    marginBottom: 4,
    borderWidth: 1,
  },
  uiAlertText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 10,
  },
  chartCard: {
    backgroundColor: '#131316',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  keywordsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  keywordChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131316',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  keywordText: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '600',
  },
  transcriptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  copyText: {
    color: '#3B82F6',
    fontSize: 13,
    fontWeight: '500',
  },
  transcriptCard: {
    backgroundColor: '#131316',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    gap: 14,
  },
  tsRow: {
    flexDirection: 'row',
  },
  tsTime: {
    color: colors.textMuted,
    fontSize: 12,
    width: 48,
  },
  tsText: {
    color: '#FFFFFF',
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  reasoningCard: {
    flexDirection: 'row',
    backgroundColor: '#131316',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  reasoningText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    flex: 1,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#18181B',
    borderRadius: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  secondaryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  primaryBtn: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingVertical: 14,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
