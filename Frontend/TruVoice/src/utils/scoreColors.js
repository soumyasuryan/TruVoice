import { colors } from '../theme';

export const getRiskScoreColor = (score) => {
  const normalizedScore = Number(score) || 0;
  if (normalizedScore >= 80) return colors.danger;
  if (normalizedScore >= 50) return colors.warning;
  return colors.success;
};

export const getRiskScoreBackground = (score, alpha = 0.08) => {
  const opacity = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${getRiskScoreColor(score)}${opacity}`;
};