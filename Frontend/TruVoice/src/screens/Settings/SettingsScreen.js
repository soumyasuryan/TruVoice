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
import { useAuthStore, useHistoryStore, useContactsStore } from '../../store';
import { useSettingsStore } from '../../store/settingsStore';
import { colors } from '../../theme';
import { getEffectiveUserName, getEffectiveUserInitials } from '../../utils/userHelper';
import { showAlert } from '../../store/alertStore';

export default function SettingsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  const historyItems = useHistoryStore((state) => state.items);
  const contacts = useContactsStore((state) => state.contacts);
  const aiProtectionEnabled = useSettingsStore((state) => state.aiProtectionEnabled);
  const elderlyModeEnabled = useSettingsStore((state) => state.elderlyModeEnabled);

  // Derive display values from auth store user, with fallbacks
  const displayName = getEffectiveUserName(user);
  const displayEmail = user?.email || `${displayName.toLowerCase().replace(/\s+/g, '.')}@truvoice.app`;
  const initials = getEffectiveUserInitials(user);

  const handleLogout = () => {
    showAlert(
      'Sign out',
      'Are you sure you want to sign out of TruVoice?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => {
            logout();
            navigation.reset({
              index: 0,
              routes: [{ name: ROUTES.LOGIN }],
            });
          },
        },
      ],
      'danger',
    );
  };

  const handleProfile = () => {
    navigation.navigate(ROUTES.PROFILE);
  };

  const handleSubscription = () => {
    navigation.navigate(ROUTES.SUBSCRIPTION);
  };

  const handleSecuritySettings = () => {
    navigation.navigate(ROUTES.SECURITY_SETTINGS);
  };

  const handleElderlyMode = () => {
    navigation.navigate(ROUTES.ELDERLY_MODE);
  };

  const handleHelpCenter = () => {
    navigation.navigate(ROUTES.HELP_CENTER);
  };

  const handleAbout = () => {
    navigation.navigate(ROUTES.ABOUT);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Profile</Text>
          {user?.isPro && (
            <View style={styles.proBadge}>
              <Text style={styles.proText}>Pro</Text>
            </View>
          )}
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom + 110, 120) },
          ]}
        >
          {/* User Card — Clickable to open Profile Screen */}
          <TouchableOpacity activeOpacity={0.8} onPress={handleProfile} style={styles.userCard}>
            <View style={styles.avatarWrapper}>
              <LinearGradient colors={['#3B82F6', '#6366F1']} style={styles.avatarGradient}>
                <Text style={styles.avatarText}>{initials}</Text>
              </LinearGradient>
              <View style={styles.avatarRing} />
            </View>

            <View style={styles.userInfoWrap}>
              <Text style={styles.userName}>{displayName}</Text>
              <Text style={styles.userEmail}>{displayEmail}</Text>
              <View style={styles.viewProfileBtn}>
                <Text style={styles.viewProfileText}>View & Edit Profile</Text>
                <Ionicons name="chevron-forward" size={14} color="#3B82F6" />
              </View>
            </View>

            {/* Stats Row */}
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{contacts.length}</Text>
                <Text style={styles.statLabel}>Trusted</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>0</Text>
                <Text style={styles.statLabel}>Blocked</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{historyItems.length}</Text>
                <Text style={styles.statLabel}>Analyzed</Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* Achievements Section */}
          <Text style={styles.sectionTitle}>Achievements</Text>
          <View style={styles.emptyAchievements}>
            <Ionicons name="ribbon-outline" size={28} color={colors.textMuted} style={{ marginBottom: 8 }} />
            <Text style={styles.emptyAchText}>No achievements yet</Text>
            <Text style={styles.emptyAchSub}>Make calls through TruVoice to unlock badges</Text>
          </View>

          {/* Menu Options */}
          <View style={styles.menuCard}>
            <TouchableOpacity activeOpacity={0.7} onPress={handleSubscription} style={styles.menuItem}>
              <View style={styles.menuLeft}>
                <View style={styles.menuIconBox}>
                  <Ionicons name="sparkles-outline" size={20} color="#3B82F6" />
                </View>
                <View>
                  <Text style={styles.menuTitle}>Subscription</Text>
                  <Text style={styles.menuSubtitle}>
                    {user?.isPro ? 'TruVoice Pro Active' : 'TruVoice Free Plan'}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.rowDivider} />

            <TouchableOpacity activeOpacity={0.7} onPress={handleSecuritySettings} style={styles.menuItem}>
              <View style={styles.menuLeft}>
                <View style={styles.menuIconBox}>
                  <Ionicons name="shield-checkmark-outline" size={20} color="#22C55E" />
                </View>
                <View>
                  <Text style={styles.menuTitle}>Security settings</Text>
                  <Text style={styles.menuSubtitle}>
                    {aiProtectionEnabled ? 'Protection Active' : 'Protection Paused'}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.rowDivider} />

            <TouchableOpacity activeOpacity={0.7} onPress={handleElderlyMode} style={styles.menuItem}>
              <View style={styles.menuLeft}>
                <View style={styles.menuIconBox}>
                  <Ionicons name="accessibility-outline" size={20} color="#A78BFA" />
                </View>
                <View>
                  <Text style={styles.menuTitle}>Elderly mode & guardian alerts</Text>
                  <Text style={styles.menuSubtitle}>
                    {elderlyModeEnabled ? 'Enabled' : 'Large text, spoken warnings & contacts'}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.rowDivider} />

            <TouchableOpacity activeOpacity={0.7} onPress={handleHelpCenter} style={styles.menuItem}>
              <View style={styles.menuLeft}>
                <View style={styles.menuIconBox}>
                  <Ionicons name="help-circle-outline" size={20} color="#F59E0B" />
                </View>
                <View>
                  <Text style={styles.menuTitle}>Help center</Text>
                  <Text style={styles.menuSubtitle}>FAQ, support, docs</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.rowDivider} />

            <TouchableOpacity activeOpacity={0.7} onPress={handleAbout} style={styles.menuItem}>
              <View style={styles.menuLeft}>
                <View style={styles.menuIconBox}>
                  <Ionicons name="information-circle-outline" size={20} color="#A855F7" />
                </View>
                <View>
                  <Text style={styles.menuTitle}>About & Legal</Text>
                  <Text style={styles.menuSubtitle}>v1.0.0 (Latest)</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Logout Button */}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleLogout}
            style={styles.logoutBtn}
          >
            <Ionicons name="log-out-outline" size={20} color="#EF4444" style={styles.logoutIcon} />
            <Text style={styles.logoutText}>Sign out</Text>
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
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  proBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  proText: {
    color: '#3B82F6',
    fontSize: 12,
    fontWeight: '700',
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
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
  },
  avatarRing: {
    position: 'absolute',
    top: -3,
    left: -3,
    right: -3,
    bottom: -3,
    borderRadius: 43,
    borderWidth: 2,
    borderColor: '#22C55E',
  },
  userInfoWrap: {
    alignItems: 'center',
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
  viewProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  viewProfileText: {
    color: '#3B82F6',
    fontSize: 12,
    fontWeight: '600',
    marginRight: 4,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  emptyAchievements: {
    backgroundColor: '#131316',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 20,
  },
  emptyAchText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  emptyAchSub: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  menuCard: {
    backgroundColor: '#131316',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginBottom: 20,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  menuLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuIconBox: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  menuTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  menuSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  rowDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 20,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  logoutIcon: {
    marginRight: 8,
  },
  logoutText: {
    color: '#EF4444',
    fontSize: 15,
    fontWeight: '600',
  },
});
