import { create } from 'zustand';

export const useAlertStore = create((set) => ({
  visible: false,
  title: '',
  message: '',
  type: 'info', // 'info' | 'success' | 'warning' | 'danger' | 'confirm'
  buttons: [],

  showAlert: ({ title, message, type = 'info', buttons = [] }) => {
    set({
      visible: true,
      title: title || '',
      message: message || '',
      type: type || 'info',
      buttons: buttons.length ? buttons : [{ text: 'OK', style: 'default' }],
    });
  },

  hideAlert: () => {
    set({ visible: false });
  },
}));

/**
 * Global helper function to show custom app-themed alerts across any screen/component.
 * Signature mirrors Alert.alert for easy drop-in replacement.
 *
 * @param {string} title - Alert title
 * @param {string} message - Alert body message
 * @param {Array<{text: string, style?: 'cancel'|'destructive'|'default', onPress?: () => void}>} buttons
 * @param {'info'|'success'|'warning'|'danger'|'confirm'} type
 */
export const showAlert = (title, message = '', buttons = [], type = 'info') => {
  let inferredType = type;
  if (!type || type === 'info') {
    if (buttons && buttons.some((b) => b.style === 'destructive')) {
      inferredType = 'danger';
    } else if (buttons && buttons.length > 1) {
      inferredType = 'confirm';
    }
  }

  useAlertStore.getState().showAlert({
    title,
    message,
    type: inferredType,
    buttons,
  });
};

export default useAlertStore;
