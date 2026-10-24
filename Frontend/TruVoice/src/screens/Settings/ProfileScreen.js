import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FloatingCallButton from '../../components/buttons/FloatingCallButton';
import { ROUTES } from '../../constants/routes';
import { useAuthStore, useHistoryStore, useContactsStore } from '../../store';
import { colors } from '../../theme';
import { tokenStorage } from '../../services/storage/tokenStorage';
import { getEffectiveUserName, getEffectiveUserInitials } from '../../utils/userHelper';
import { showAlert } from '../../store/alertStore';

export default function ProfileScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((state) => state.user);
  const historyItems = useHistoryStore((state) => state.items);
  const contacts = useContactsStore((state) => state.contacts);

  const displayName = getEffectiveUserName(user);
  const displayEmail = user?.email || `${displayName.toLowerCase().replace(/\s+/g, '.')}@truvoice.app`;

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(displayName);
  const [email, setEmail] = useState(displayEmail);
  const [isSaving, setIsSaving] = useState(false);

  const displayPhone = user?.phone_number || user?.phone || 'Not set';
  const initials = getEffectiveUserInitials(user);

  const handleSave = async () => {
    if (!name.trim()) {
      showAlert('Required Field', 'Please enter your name.', [], 'warning');
      return;
    }
    setIsSaving(true);
    try {
      const updatedUser = {
        ...user,
        name: name.trim(),
        email: email.trim(),
      };
      // Update state in Zustand store
      useAuthStore.setState({ user: updatedUser });
      // Persist in local storage
      const token = useAuthStore.getState().token;
      if (token) {
        await tokenStorage.saveSession(token, updatedUser);
      }
      setIsEditing(false);
      showAlert('Profile Updated', 'Your profile details have been successfully saved.', [], 'success');
    } catch (err) {
      showAlert('Error', 'Failed to save profile changes.', [], 'danger');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
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
            <Text style={styles.headerTitle}>User Profile</Text>
            <TouchableOpacity
              onPress={isEditing ? handleSave : () => setIsEditing(true)}
              style={styles.editHeaderBtn}
              activeOpacity={0.7}
              disabled={isSaving}
            >
              <Text style={styles.editHeaderBtnText}>
                {isEditing ? (isSaving ? 'Saving...' : 'Save') : 'Edit'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: Math.max(insets.bottom + 110, 120) },
            ]}
          >
            {/* User Card */}
            <View style={styles.userCard}>
              <View style={styles.avatarWrapper}>
                <LinearGradient colors={['#3B82F6', '#6366F1']} style={styles.avatarGradient}>
                  <Text style={styles.avatarText}>{initials}</Text>
                </LinearGradient>
                <View style={styles.avatarRing} />
              </View>

              <Text style={styles.userName}>{displayName}</Text>
              <Text style={styles.userEmail}>{displayEmail}</Text>

              {user?.isPro ? (
                <View style={styles.proBadge}>
                  <Ionicons name="sparkles" size={12} color="#3B82F6" style={{ marginRight: 4 }} />
                  <Text style={styles.proText}>TruVoice Pro Member</Text>
                </View>
              ) : (
                <View style={styles.freeBadge}>
                  <Text style={styles.freeText}>Free Account</Text>
                </View>
              )}
            </View>

            {/* Quick Stats Grid */}
            <View style={styles.statsGrid}>
              <View style={styles.statCard}>
                <Ionicons name="shield-checkmark-outline" size={22} color="#3B82F6" />
                <Text style={styles.statVal}>{historyItems.length}</Text>
                <Text style={styles.statLbl}>Calls Analyzed</Text>
              </View>
              <View style={styles.statCard}>
                <Ionicons name="people-outline" size={22} color="#22C55E" />
                <Text style={styles.statVal}>{contacts.length}</Text>
                <Text style={styles.statLbl}>Trusted Contacts</Text>
              </View>
              <View style={styles.statCard}>
                <Ionicons name="ban-outline" size={22} color="#EF4444" />
                <Text style={styles.statVal}>0</Text>
                <Text style={styles.statLbl}>Blocked Scammers</Text>
              </View>
            </View>

            {/* Profile Information Form */}
            <Text style={styles.sectionTitle}>Account Details</Text>
            <View style={styles.card}>
              <View style={styles.fieldRow}>
                <Ionicons name="person-outline" size={20} color={colors.textMuted} style={styles.fieldIcon} />
                <View style={styles.fieldContent}>
                  <Text style={styles.fieldLabel}>Full Name</Text>
                  {isEditing ? (
                    <TextInput
                      style={styles.fieldInput}
                      value={name}
                      onChangeText={setName}
                      placeholder="Enter full name"
                      placeholderTextColor={colors.textMuted}
                    />
                  ) : (
                    <Text style={styles.fieldValue}>{displayName}</Text>
                  )}
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.fieldRow}>
                <Ionicons name="mail-outline" size={20} color={colors.textMuted} style={styles.fieldIcon} />
                <View style={styles.fieldContent}>
                  <Text style={styles.fieldLabel}>Email Address</Text>
                  {isEditing ? (
                    <TextInput
                      style={styles.fieldInput}
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      placeholder="Enter email address"
                      placeholderTextColor={colors.textMuted}
                    />
                  ) : (
                    <Text style={styles.fieldValue}>{displayEmail || 'Not provided'}</Text>
                  )}
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.fieldRow}>
                <Ionicons name="call-outline" size={20} color={colors.textMuted} style={styles.fieldIcon} />
                <View style={styles.fieldContent}>
                  <Text style={styles.fieldLabel}>Phone Number</Text>
                  <Text style={styles.fieldValue}>{displayPhone}</Text>
                </View>
                <View style={styles.verifiedTag}>
                  <Ionicons name="checkmark-circle" size={14} color="#22C55E" style={{ marginRight: 3 }} />
                  <Text style={styles.verifiedText}>Verified</Text>
                </View>
              </View>
            </View>

            {/* Security & Verification Card */}
            <Text style={styles.sectionTitle}>Security & Identity</Text>
            <View style={styles.card}>
              <View style={styles.fieldRow}>
                <Ionicons name="shield-outline" size={20} color="#3B82F6" style={styles.fieldIcon} />
                <View style={styles.fieldContent}>
                  <Text style={styles.fieldLabel}>Voice Print Status</Text>
                  <Text style={styles.fieldValue}>Protected by TruVoice AI</Text>
                </View>
              </View>
              <View style={styles.divider} />
              <View style={styles.fieldRow}>
                <Ionicons name="lock-closed-outline" size={20} color="#22C55E" style={styles.fieldIcon} />
                <View style={styles.fieldContent}>
                  <Text style={styles.fieldLabel}>Encryption</Text>
                  <Text style={styles.fieldValue}>AES-256 WebRTC Active</Text>
                </View>
              </View>
            </View>
          </ScrollView>

          <FloatingCallButton onPress={() => navigation.navigate(ROUTES.KEYPAD)} />
        </View>
      </KeyboardAvoidingView>
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
  editHeaderBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
  },
  editHeaderBtnText: {
    color: '#3B82F6',
    fontSize: 14,
    fontWeight: '600',
  },
  scrollContent: {
    paddingTop: 8,
  },
  userCard: {
    backgroundColor: '#131316',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 20,
  },
  avatarWrapper: {
    position: 'relative',
    marginBottom: 12,
  },
  avatarGradient: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '700',
  },
  avatarRing: {
    position: 'absolute',
    top: -3,
    left: -3,
    right: -3,
    bottom: -3,
    borderRadius: 45,
    borderWidth: 2,
    borderColor: '#3B82F6',
  },
  userName: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  userEmail: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  proBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  proText: {
    color: '#3B82F6',
    fontSize: 12,
    fontWeight: '700',
  },
  freeBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    marginTop: 12,
  },
  freeText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#131316',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  statVal: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 8,
  },
  statLbl: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
    textAlign: 'center',
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
    paddingVertical: 8,
    marginBottom: 20,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  fieldIcon: {
    marginRight: 14,
  },
  fieldContent: {
    flex: 1,
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 12,
  },
  fieldValue: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 2,
  },
  fieldInput: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    backgroundColor: '#18181B',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  verifiedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  verifiedText: {
    color: '#22C55E',
    fontSize: 11,
    fontWeight: '600',
  },
});
