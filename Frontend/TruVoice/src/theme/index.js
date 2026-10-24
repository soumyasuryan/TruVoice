export { colors } from './colors';
export { typography } from './typography';
export { spacing, radius, layout } from './spacing';
export { shadows } from './shadows';

import { colors } from './colors';
import { typography } from './typography';

export const paperTheme = {
  dark: true,
  colors: {
    primary: colors.primary,
    onPrimary: colors.text,
    primaryContainer: colors.primaryDark,
    onPrimaryContainer: colors.text,
    secondary: colors.success,
    onSecondary: colors.text,
    background: colors.background,
    onBackground: colors.text,
    surface: colors.backgroundCard,
    onSurface: colors.text,
    surfaceVariant: colors.backgroundInput,
    onSurfaceVariant: colors.textSecondary,
    outline: colors.surfaceBorder,
    error: colors.danger,
    onError: colors.text,
    elevation: {
      level0: colors.background,
      level1: colors.backgroundElevated,
      level2: colors.backgroundCard,
      level3: colors.surface,
      level4: colors.surface,
      level5: colors.surface,
    },
  },
  fonts: {
    displayLarge: typography.display,
    displayMedium: typography.h1,
    displaySmall: typography.h2,
    headlineLarge: typography.h2,
    headlineMedium: typography.h3,
    headlineSmall: typography.h3,
    titleLarge: typography.h3,
    titleMedium: typography.bodyMedium,
    titleSmall: typography.bodySmall,
    bodyLarge: typography.body,
    bodyMedium: typography.bodySmall,
    bodySmall: typography.caption,
    labelLarge: typography.button,
    labelMedium: typography.label,
    labelSmall: typography.caption,
  },
};

export default {
  colors,
  typography,
  paperTheme,
};
