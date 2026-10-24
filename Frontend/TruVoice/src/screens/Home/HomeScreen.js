import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import VoiceShieldCard from '../../components/cards/VoiceShieldCard';
import RecentContactsScroll from '../../components/cards/RecentContactsScroll';
import RecentCallList from '../../components/cards/RecentCallList';
import FloatingCallButton from '../../components/buttons/FloatingCallButton';
import { ROUTES } from '../../constants/routes';
import { useContactsStore } from '../../store/contactsStore';
import { useAuthStore } from '../../store';
import { agoraService } from '../../services/agora/agoraService';
import { colors } from '../../theme';
import { getEffectiveUserName, getEffectiveUserInitials } from '../../utils/userHelper';

export default function HomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');
  const { loadContacts } = useContactsStore();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);

  const displayName = getEffectiveUserName(user);
  const firstName = displayName.split(' ')[0];
  const userInitials = getEffectiveUserInitials(user);

  useEffect(() => {
    loadContacts();
    if (user?.id && token) {
      agoraService.init(user.id, token);
    }
  }, [user, token]);


  const handleStartCall = () => {
    navigation.navigate(ROUTES.KEYPAD);
  };

  const handleNotificationsPress = () => {
    navigation.navigate(ROUTES.NOTIFICATIONS);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTextContainer}>
            <Text style={styles.greetingTitle}>Hi, {firstName}</Text>
            <Text style={styles.protectionSubtext}>
              Protection active
            </Text>
          </View>

          <View style={styles.headerRight}>
            {/* Notification Bell */}
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleNotificationsPress}
              style={styles.iconButton}
            >
              <Ionicons name="notifications-outline" size={22} color="#FFFFFF" />
              <View style={styles.unreadBadgeDot} />
            </TouchableOpacity>

            {/* User Profile Avatar */}
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => navigation.navigate(ROUTES.SETTINGS)}
              style={styles.profileAvatarContainer}
            >
              <LinearGradient
                colors={['#3B82F6', '#6366F1']}
                style={styles.avatarGradient}
              >
                <Text style={styles.avatarText}>{userInitials}</Text>
              </LinearGradient>
              <View style={styles.avatarStatusRing} />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom + 110, 120) },
          ]}
        >
          {/* Search Input */}
          <View style={styles.searchContainer}>
            <Ionicons name="search-outline" size={20} color={colors.textMuted} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search people, numbers, calls"
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery ? (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Voice Shield Live Card */}
          <VoiceShieldCard onStartCall={handleStartCall} />

          {/* Recent Contacts Carousel */}
          <RecentContactsScroll
            onSelectContact={(contact) =>
              navigation.navigate(ROUTES.OUTGOING_CALL, { contact })
            }
            onSeeAll={() => navigation.navigate(ROUTES.CALLS)}
          />

          {/* Recent Calls List */}
          <RecentCallList
            onSelectCall={(call) => navigation.navigate(ROUTES.CALL_DETAILS, { call })}
            onHistoryPress={() => navigation.navigate(ROUTES.HISTORY)}
          />
        </ScrollView>

        {/* Floating Action Call Button */}
        <FloatingCallButton onPress={handleStartCall} />
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
  headerTextContainer: {
    flex: 1,
  },
  greetingTitle: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  protectionSubtext: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  unreadBadgeDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
  profileAvatarContainer: {
    position: 'relative',
  },
  avatarGradient: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  avatarStatusRing: {
    position: 'absolute',
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#22C55E',
  },
  scrollContent: {
    paddingTop: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181B',
    borderRadius: 20,
    paddingHorizontal: 16,
    height: 50,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
  },
});
