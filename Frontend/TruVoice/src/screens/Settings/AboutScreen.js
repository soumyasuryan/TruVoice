import React from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FloatingCallButton from '../../components/buttons/FloatingCallButton';
import { ROUTES } from '../../constants/routes';
import { colors } from '../../theme';
import { showAlert } from '../../store/alertStore';

export default function AboutScreen({ navigation }) {
  const insets = useSafeAreaInsets();

  const handleCheckUpdates = () => {
    showAlert('Up to Date', 'TruVoice v1.0.0 is the latest version available.', [], 'info');
  };

  const handleOpenLegal = (title, content) => {
    showAlert(title, content, [], 'info');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>About TruVoice</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom + 110, 120) },
          ]}
        >
          {/* App Branding Card */}
          <View style={styles.brandCard}>
            <LinearGradient colors={['#3B82F6', '#6366F1']} style={styles.logoGradient}>
              <Ionicons name="shield-checkmark" size={40} color="#FFFFFF" />
            </LinearGradient>
            <Text style={styles.appName}>TruVoice</Text>
            <Text style={styles.appTagline}>Real-Time AI Voice Protection & Fraud Defense</Text>
            <View style={styles.versionPill}>
              <Text style={styles.versionText}>Version 1.0.0 (Build 2026.8.19)</Text>
            </View>
          </View>

          {/* Engine Specifications */}
          <Text style={styles.sectionTitle}>Engine & Architecture</Text>
          <View style={styles.card}>
            <View style={styles.specRow}>
              <Ionicons name="hardware-chip-outline" size={18} color="#3B82F6" style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.specLabel}>AI Voice Detection Engine</Text>
                <Text style={styles.specVal}>TruVoice Neural Engine v2.4</Text>
              </View>
            </View>
            <View style={styles.rowDivider} />
            <View style={styles.specRow}>
              <Ionicons name="globe-outline" size={18} color="#22C55E" style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.specLabel}>Voice Communication Pipeline</Text>
                <Text style={styles.specVal}>Agora WebRTC Audio Subsystem</Text>
              </View>
            </View>
            <View style={styles.rowDivider} />
            <View style={styles.specRow}>
              <Ionicons name="chatbubbles-outline" size={18} color="#F59E0B" style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.specLabel}>Speech-to-Text Pipeline</Text>
                <Text style={styles.specVal}>Whisper On-Device STT Engine</Text>
              </View>
            </View>
          </View>

          {/* Legal & Compliance */}
          <Text style={styles.sectionTitle}>Legal & Privacy Policy</Text>
          <View style={styles.card}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() =>
                handleOpenLegal(
                  'Terms of Service',
                  'TruVoice provides real-time voice verification and call intelligence. By using this application, you agree to respect communication privacy and user consent guidelines.',
                )
              }
              style={styles.legalRow}
            >
              <View style={styles.legalLeft}>
                <Ionicons name="document-text-outline" size={18} color={colors.textMuted} style={{ marginRight: 12 }} />
                <Text style={styles.legalText}>Terms of Service</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.rowDivider} />

            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() =>
                handleOpenLegal(
                  'Privacy Policy',
                  'TruVoice prioritizes user privacy. Audio streams are processed locally on your device. No raw call recordings are stored on servers without explicit user request.',
                )
              }
              style={styles.legalRow}
            >
              <View style={styles.legalLeft}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} style={{ marginRight: 12 }} />
                <Text style={styles.legalText}>Privacy Policy & Data Security</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.rowDivider} />

            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() =>
                handleOpenLegal(
                  'Open Source Notices',
                  'TruVoice utilizes open source software including React Native, Expo, Zustand, Axios, and WebRTC protocols.',
                )
              }
              style={styles.legalRow}
            >
              <View style={styles.legalLeft}>
                <Ionicons name="code-slash-outline" size={18} color={colors.textMuted} style={{ marginRight: 12 }} />
                <Text style={styles.legalText}>Open Source Licenses</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Action Button */}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleCheckUpdates}
            style={styles.updateBtn}
          >
            <Ionicons name="refresh-outline" size={18} color="#3B82F6" style={{ marginRight: 8 }} />
            <Text style={styles.updateBtnText}>Check for Updates</Text>
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
  scrollContent: {
    paddingTop: 8,
  },
  brandCard: {
    backgroundColor: '#131316',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 20,
  },
  logoGradient: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  appName: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  appTagline: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  versionPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    marginTop: 14,
  },
  versionText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#131316',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginBottom: 20,
  },
  specRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  specLabel: {
    color: colors.textMuted,
    fontSize: 12,
  },
  specVal: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  rowDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  legalLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legalText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  updateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#131316',
    borderRadius: 18,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.25)',
  },
  updateBtnText: {
    color: '#3B82F6',
    fontSize: 14,
    fontWeight: '600',
  },
});
