import { Platform } from 'react-native';

const createShadow = (color, elevation = 8) =>
  Platform.select({
    ios: {
      shadowColor: color,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.35,
      shadowRadius: 12,
    },
    android: { elevation },
    default: {},
  });

export const shadows = {
  none: {},
  sm: createShadow('#000000', 2),
  md: createShadow('#000000', 4),
  lg: createShadow('#000000', 8),
  xl: createShadow('#000000', 12),
  primaryGlow: createShadow('#3B82F6', 10),
  successGlow: createShadow('#22C55E', 10),
  dangerGlow: createShadow('#EF4444', 10),
};

export default shadows;
