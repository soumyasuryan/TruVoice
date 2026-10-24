import { create } from 'zustand';

export const useSettingsStore = create((set) => ({
  aiProtectionEnabled: true,
  notificationsEnabled: true,
  biometricEnabled: false,
  hapticFeedback: true,
  elderlyModeEnabled: false,

  toggleAiProtection: () =>
    set((state) => ({ aiProtectionEnabled: !state.aiProtectionEnabled })),
  toggleNotifications: () =>
    set((state) => ({ notificationsEnabled: !state.notificationsEnabled })),
  toggleBiometric: () =>
    set((state) => ({ biometricEnabled: !state.biometricEnabled })),
  toggleHaptic: () =>
    set((state) => ({ hapticFeedback: !state.hapticFeedback })),
  setElderlyModeEnabled: (enabled) =>
    set({ elderlyModeEnabled: Boolean(enabled) }),
}));

export default useSettingsStore;
