import { create } from 'zustand';
import { mapAnalysisToStore, normalizeAnalysis } from '../utils/analysisMapper';

const pickEither = (obj, camelKey, snakeKey, fallback = undefined) => {
  if (obj == null) return fallback;
  const camel = obj[camelKey];
  const snake = obj[snakeKey];
  if (camel !== undefined && camel !== null) return camel;
  if (snake !== undefined && snake !== null) return snake;
  return fallback;
};

export const useAiDetectionStore = create((set) => ({
  authenticityScore: 100,
  aiProbability: 0,
  confidence: 0,
  riskLevel: 'low',
  riskLevelLabel: 'SAFE',
  scamCategory: '',
  scamIntentScore: 0,
  unifiedRiskScore: 0,
  threatType: 'NORMAL',
  uiAlert: 'This call looks safe.',
  riskEvents: [],
  transcript: [],
  analysisReasons: [],
  lastAnalysis: null,
  isAnalyzing: false,

  updateFromBackend: (data) => {
    const normalized = normalizeAnalysis(data);
    const mapped = mapAnalysisToStore(data);
    set({
      ...mapped,
      riskLevelLabel:
        pickEither(data, 'riskLevelLabel', 'risk_level', normalized.riskLevelLabel) ||
        mapped.riskLevelLabel,
      scamCategory:
        pickEither(data, 'scamCategory', 'scam_category', normalized.scamCategory) ||
        '',
      scamIntentScore: Math.round(
        pickEither(data, 'scamIntentScore', 'scam_intent_score', normalized.scamIntentScore) ?? 0,
      ),
      unifiedRiskScore: Math.round(
        pickEither(data, 'unifiedRiskScore', 'unified_risk_score', normalized.unifiedRiskScore) ?? 0,
      ),
      threatType:
        pickEither(data, 'threatType', 'threat_type', normalized.threatType) || 'NORMAL',
      uiAlert:
        pickEither(data, 'uiAlert', 'ui_alert', normalized.uiAlert) || 'This call looks safe.',
      lastAnalysis: mapped.lastAnalysis || normalized,
    });
  },

  updateAnalysis: (data) =>
    set({
      authenticityScore: data.authenticityScore ?? 100,
      aiProbability: data.aiProbability ?? 0,
      confidence: data.confidence ?? 0,
      riskLevel: data.riskLevel ?? 'low',
      riskEvents: data.riskEvents ?? [],
      analysisReasons: data.analysisReasons ?? [],
      transcript: data.transcript ?? [],
    }),

  setAnalyzing: (isAnalyzing) => set({ isAnalyzing }),
  reset: () =>
    set({
      authenticityScore: 100,
      aiProbability: 0,
      confidence: 0,
      riskLevel: 'low',
      riskLevelLabel: 'SAFE',
      scamCategory: '',
      scamIntentScore: 0,
      unifiedRiskScore: 0,
      threatType: 'NORMAL',
      uiAlert: 'This call looks safe.',
      riskEvents: [],
      transcript: [],
      analysisReasons: [],
      lastAnalysis: null,
      isAnalyzing: false,
    }),
}));

export default useAiDetectionStore;
