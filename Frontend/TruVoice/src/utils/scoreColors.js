import { colors } from '../theme';

export const getRiskScoreColor = (score) => {
  const normalizedScore = Number(score) || 0;
  if (normalizedScore >= 80) return colors.danger;
  if (normalizedScore >= 50) return colors.warning;
  return colors.success;
};

export const getAiProbabilityColor = getRiskScoreColor;

export const getCallRiskColor = (riskLevel, score) => {
  const normalizedLevel = String(riskLevel || '').toLowerCase();
  const normalizedScore = Number(score) || 0;
  if (
    normalizedScore >= 70 ||
    ['severe', 'critical', 'high'].some((level) => normalizedLevel.includes(level))
  ) {
    return colors.danger;
  }
  if (
    normalizedScore >= 50 ||
    ['moderate', 'medium'].some((level) => normalizedLevel.includes(level))
  ) {
    return colors.warning;
  }
  return colors.success;
};

export const getVoiceAuthenticityColor = (score) => {
  const normalizedScore = Number(score) || 0;
  if (normalizedScore < 50) return colors.danger;
  if (normalizedScore < 80) return colors.warning;
  return colors.success;
};

export const getVoiceClassificationColor = (classification) => {
  switch (String(classification).toLowerCase()) {
    case 'ai':
    case 'synthetic voice':
      return colors.danger;
    case 'suspicious':
      return colors.warning;
    case 'human':
    case 'verified human':
      return colors.success;
    default:
      return null;
  }
};

export const getRiskScoreBackground = (score, alpha = 0.08) => {
  const opacity = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${getRiskScoreColor(score)}${opacity}`;
};