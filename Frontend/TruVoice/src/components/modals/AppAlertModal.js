import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TouchableWithoutFeedback,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAlertStore } from '../../store/alertStore';
import { colors } from '../../theme';

export default function AppAlertModal() {
  const { visible, title, message, type, buttons, hideAlert } = useAlertStore();

  if (!visible) return null;

  const getAlertIcon = () => {
    switch (type) {
      case 'success':
        return { name: 'checkmark-circle-outline', color: '#22C55E', bg: 'rgba(34, 197, 94, 0.15)' };
      case 'warning':
        return { name: 'warning-outline', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.15)' };
      case 'danger':
        return { name: 'alert-circle-outline', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.15)' };
      case 'confirm':
        return { name: 'help-circle-outline', color: '#6366F1', bg: 'rgba(99, 102, 241, 0.15)' };
      default:
        return { name: 'information-circle-outline', color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.15)' };
    }
  };

  const iconInfo = getAlertIcon();

  const handleButtonPress = (btn) => {
    hideAlert();
    if (btn.onPress && typeof btn.onPress === 'function') {
      setTimeout(() => {
        btn.onPress();
      }, 50);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={hideAlert}
    >
      <TouchableWithoutFeedback onPress={hideAlert}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.cardContainer}>
              {/* Icon Badge */}
              <View style={[styles.iconBox, { backgroundColor: iconInfo.bg }]}>
                <Ionicons name={iconInfo.name} size={30} color={iconInfo.color} />
              </View>

              {/* Title & Message */}
              {title ? <Text style={styles.titleText}>{title}</Text> : null}
              {message ? <Text style={styles.messageText}>{message}</Text> : null}

              {/* Buttons Row */}
              <View style={styles.buttonsRow}>
                {buttons && buttons.length > 0 ? (
                  buttons.map((btn, index) => {
                    const isDestructive = btn.style === 'destructive';
                    const isCancel = btn.style === 'cancel';
                    return (
                      <TouchableOpacity
                        key={index}
                        activeOpacity={0.7}
                        onPress={() => handleButtonPress(btn)}
                        style={[
                          styles.btn,
                          buttons.length === 1 ? styles.btnFull : styles.btnFlex,
                          isDestructive
                            ? styles.btnDestructive
                            : isCancel
                              ? styles.btnCancel
                              : styles.btnPrimary,
                        ]}
                      >
                        <Text
                          style={[
                            styles.btnText,
                            isDestructive
                              ? styles.btnTextDestructive
                              : isCancel
                                ? styles.btnTextCancel
                                : styles.btnTextPrimary,
                          ]}
                        >
                          {btn.text || 'OK'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                ) : (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={hideAlert}
                    style={[styles.btn, styles.btnFull, styles.btnPrimary]}
                  >
                    <Text style={[styles.btnText, styles.btnTextPrimary]}>OK</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 11, 0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  cardContainer: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#131316',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
      },
      android: {
        elevation: 10,
      },
    }),
  },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  titleText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  messageText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
    width: '100%',
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnFull: {
    width: '100%',
  },
  btnFlex: {
    flex: 1,
  },
  btnPrimary: {
    backgroundColor: '#3B82F6',
  },
  btnCancel: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  btnDestructive: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  btnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  btnTextPrimary: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  btnTextCancel: {
    color: '#FFFFFF',
  },
  btnTextDestructive: {
    color: '#EF4444',
    fontWeight: '700',
  },
});
