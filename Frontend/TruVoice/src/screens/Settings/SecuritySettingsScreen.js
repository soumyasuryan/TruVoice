import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
  Alert,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FloatingCallButton from '../../components/buttons/FloatingCallButton';
import { ROUTES } from '../../constants/routes';
import { useSettingsStore } from '../../store/settingsStore';
import { colors } from '../../theme';
import { showAlert } from '../../store/alertStore';

export default function SecuritySettingsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const {
    aiProtectionEnabled,
    notificationsEnabled,
    biometricEnabled,
    hapticFeedback,
    toggleAiProtection,
    toggleNotifications,
    toggleBiometric,
    toggleHaptic,
  } = useSettingsStore();

  const [blockedNumbers, setBlockedNumbers] = useState([
    { id: '1', number: '+1 (555) 948-2041', date: 'Yesterday' },
    { id: '2', number: '+1 (555) 012-9923', date: '3 days ago' },
  ]);
  const [newBlockNumber, setNewBlockNumber] = useState('');
  const [showAddBlockModal, setShowAddBlockModal] = useState(false);

  const handleUnblock = (id, number) => {
    showAlert(
      'Unblock Number',
      `Unblock ${number}? You will receive calls from this number again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          style: 'destructive',
          onPress: () => {
            setBlockedNumbers((prev) => prev.filter((item) => item.id !== id));
          },
        },
      ],
      'warning',
    );
  };

  const handleAddBlock = () => {
    if (!newBlockNumber.trim()) {
      showAlert('Required', 'Please enter a valid phone number.', [], 'warning');
      return;
    }
    const newEntry = {
      id: String(Date.now()),
      number: newBlockNumber.trim(),
      date: 'Just now',
    };
    setBlockedNumbers((prev) => [newEntry, ...prev]);
    setNewBlockNumber('');
    setShowAddBlockModal(false);
    showAlert('Blocked', `${newBlockNumber.trim()} has been added to your blocked list.`, [], 'success');
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
          <Text style={styles.headerTitle}>Security & Privacy</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom + 110, 120) },
          ]}
        >
          {/* Main Security Badge */}
          <View style={styles.heroCard}>
            <View style={styles.heroIconBox}>
              <Ionicons name="shield-checkmark" size={32} color="#22C55E" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>End-to-End Encrypted</Text>
              <Text style={styles.heroSub}>
                WebRTC audio streams are encrypted via AES-256. Voice analysis is performed locally on-device.
              </Text>
            </View>
          </View>

          {/* AI & Scam Protection Settings */}
          <Text style={styles.sectionTitle}>AI Fraud & Scam Protection</Text>
          <View style={styles.card}>
            <View style={styles.switchRow}>
              <View style={styles.switchIconBox}>
                <Ionicons name="hardware-chip-outline" size={20} color="#3B82F6" />
              </View>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={styles.switchTitle}>Real-time AI Voice Detection</Text>
                <Text style={styles.switchSub}>Analyze call audio live to detect synthetic AI voices</Text>
              </View>
              <Switch
                value={aiProtectionEnabled}
                onValueChange={toggleAiProtection}
                trackColor={{ false: '#27272A', true: '#3B82F6' }}
                thumbColor="#FFFFFF"
              />
            </View>

            <View style={styles.rowDivider} />

            <View style={styles.switchRow}>
              <View style={styles.switchIconBox}>
                <Ionicons name="vibrate-outline" size={20} color="#F59E0B" />
              </View>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={styles.switchTitle}>Haptic Fraud Alert</Text>
                <Text style={styles.switchSub}>Vibrate device when high scam risk is detected during calls</Text>
              </View>
              <Switch
                value={hapticFeedback}
                onValueChange={toggleHaptic}
                trackColor={{ false: '#27272A', true: '#3B82F6' }}
                thumbColor="#FFFFFF"
              />
            </View>
          </View>

          {/* App Access & Privacy Controls */}
          <Text style={styles.sectionTitle}>App Security & Access</Text>
          <View style={styles.card}>
            <View style={styles.switchRow}>
              <View style={styles.switchIconBox}>
                <Ionicons name="finger-print-outline" size={20} color="#22C55E" />
              </View>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={styles.switchTitle}>Biometrics / App Lock</Text>
                <Text style={styles.switchSub}>Require FaceID or fingerprint to open TruVoice app</Text>
              </View>
              <Switch
                value={biometricEnabled}
                onValueChange={toggleBiometric}
                trackColor={{ false: '#27272A', true: '#3B82F6' }}
                thumbColor="#FFFFFF"
              />
            </View>

            <View style={styles.rowDivider} />

            <View style={styles.switchRow}>
              <View style={styles.switchIconBox}>
                <Ionicons name="notifications-outline" size={20} color="#A855F7" />
              </View>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={styles.switchTitle}>Security Threat Alerts</Text>
                <Text style={styles.switchSub}>Receive push notifications for critical scam spikes</Text>
              </View>
              <Switch
                value={notificationsEnabled}
                onValueChange={toggleNotifications}
                trackColor={{ false: '#27272A', true: '#3B82F6' }}
                thumbColor="#FFFFFF"
              />
            </View>
          </View>

          {/* Encryption Protocol Details */}
          <Text style={styles.sectionTitle}>Protocols & Infrastructure</Text>
          <View style={styles.card}>
            <View style={styles.infoRow}>
              <Ionicons name="lock-closed" size={18} color="#22C55E" style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.infoTitle}>Audio Stream Encryption</Text>
                <Text style={styles.infoVal}>DTLS-SRTP AES-256 (WebRTC)</Text>
              </View>
            </View>

            <View style={styles.rowDivider} />

            <View style={styles.infoRow}>
              <Ionicons name="cloud-done-outline" size={18} color="#3B82F6" style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.infoTitle}>Transport Layer Security</Text>
                <Text style={styles.infoVal}>TLS 1.3 (Rest API & Signaling WS)</Text>
              </View>
            </View>
          </View>

          {/* Blocked Caller Blacklist Manager */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Blocked Numbers ({blockedNumbers.length})</Text>
            <TouchableOpacity onPress={() => setShowAddBlockModal(!showAddBlockModal)}>
              <Text style={styles.addBlockBtnText}>+ Add Block</Text>
            </TouchableOpacity>
          </View>

          {showAddBlockModal && (
            <View style={styles.addBlockBox}>
              <TextInput
                style={styles.blockInput}
                placeholder="Enter phone number to block"
                placeholderTextColor={colors.textMuted}
                value={newBlockNumber}
                onChangeText={setNewBlockNumber}
                keyboardType="phone-pad"
              />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <TouchableOpacity
                  onPress={() => setShowAddBlockModal(false)}
                  style={[styles.modalBtn, { backgroundColor: '#18181B' }]}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleAddBlock}
                  style={[styles.modalBtn, { backgroundColor: '#EF4444' }]}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Block Number</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.card}>
            {blockedNumbers.length > 0 ? (
              blockedNumbers.map((item, idx) => (
                <View key={item.id}>
                  <View style={styles.blockedRow}>
                    <Ionicons name="ban" size={18} color="#EF4444" style={{ marginRight: 12 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.blockedNumberText}>{item.number}</Text>
                      <Text style={styles.blockedDateText}>Blocked {item.date}</Text>
                    </View>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => handleUnblock(item.id, item.number)}
                      style={styles.unblockBtn}
                    >
                      <Text style={styles.unblockBtnText}>Unblock</Text>
                    </TouchableOpacity>
                  </View>
                  {idx !== blockedNumbers.length - 1 && <View style={styles.rowDivider} />}
                </View>
              ))
            ) : (
              <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                <Text style={{ color: colors.textMuted, fontSize: 13 }}>No blocked numbers</Text>
              </View>
            )}
          </View>
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
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.08)',
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.25)',
    marginBottom: 20,
  },
  heroIconBox: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  heroSub: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 18,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  addBlockBtnText: {
    color: '#3B82F6',
    fontSize: 13,
    fontWeight: '600',
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  switchIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  switchTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  switchSub: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  rowDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  infoTitle: {
    color: colors.textMuted,
    fontSize: 12,
  },
  infoVal: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  blockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  blockedNumberText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  blockedDateText: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  unblockBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  unblockBtnText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '600',
  },
  addBlockBox: {
    backgroundColor: '#131316',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 16,
  },
  blockInput: {
    color: '#FFFFFF',
    fontSize: 14,
    backgroundColor: '#18181B',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
  },
});
