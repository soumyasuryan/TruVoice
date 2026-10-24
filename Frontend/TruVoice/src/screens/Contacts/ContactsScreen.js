import React, { useEffect, useState } from 'react';
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
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FloatingCallButton from '../../components/buttons/FloatingCallButton';
import { ROUTES } from '../../constants/routes';
import { useContactsStore } from '../../store/contactsStore';
import { colors } from '../../theme';

// No fallback/dummy contacts — only real device contacts are displayed

export default function ContactsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const { contacts, permissionGranted, isLoading, loadContacts, requestPermissionAndLoad } = useContactsStore();

  useEffect(() => {
    loadContacts();
  }, []);

  const displayList = (contacts || []).filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.number.toLowerCase().includes(search.toLowerCase())
  );

  const favorites = displayList.slice(0, 3);

  // Group remaining contacts by first letter
  const groupedContacts = displayList.reduce((acc, contact) => {
    const letter = (contact.name[0] || 'A').toUpperCase();
    if (!acc[letter]) {
      acc[letter] = [];
    }
    acc[letter].push(contact);
    return acc;
  }, {});

  const sortedLetters = Object.keys(groupedContacts).sort();

  const startCall = (contact) => {
    navigation.navigate(ROUTES.OUTGOING_CALL, { contact });
  };

  const handleRequestPermission = async () => {
    await requestPermissionAndLoad();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Contacts</Text>
          <Text style={styles.subtitle}>
            {displayList.length} people · {displayList.filter((c) => c.isOnline).length} online
          </Text>
        </View>

        {/* Permission Request Banner if permission not granted */}
        {!permissionGranted && (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={handleRequestPermission}
            style={styles.permissionBanner}
          >
            <Ionicons name="people-circle-outline" size={24} color="#3B82F6" style={{ marginRight: 10 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.permTitle}>Allow TruVoice to sync contacts</Text>
              <Text style={styles.permSub}>Tap to request phone contacts permission for AI call protection.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#3B82F6" />
          </TouchableOpacity>
        )}

        {/* Search Input */}
        <View style={styles.searchContainer}>
          <Ionicons name="search-outline" size={20} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search contacts by name or number"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text style={styles.loadingText}>Fetching device contacts...</Text>
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: Math.max(insets.bottom + 110, 120) },
            ]}
          >
            {/* Favorites */}
            {favorites.length > 0 && (
              <>
                <Text style={styles.sectionHeading}>Favorites</Text>
                <View style={styles.favoritesRow}>
                  {favorites.map((fav) => (
                    <TouchableOpacity
                      key={fav.id}
                      activeOpacity={0.8}
                      onPress={() => startCall(fav)}
                      style={styles.favoriteCard}
                    >
                      <View style={styles.favAvatarContainer}>
                        <LinearGradient colors={fav.colors} style={styles.favAvatar}>
                          <Text style={styles.favAvatarText}>{fav.initials}</Text>
                        </LinearGradient>
                        {fav.isOnline && <View style={styles.favOnlineBadge} />}
                      </View>
                      <Text style={styles.favName} numberOfLines={1}>
                        {fav.name.split(' ')[0]}
                      </Text>
                      <View style={styles.favCallBtn}>
                        <Ionicons name="call" size={16} color="#3B82F6" />
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Grouped Alphabetical List */}
            {sortedLetters.map((letter) => (
              <View key={letter} style={styles.groupContainer}>
                <Text style={styles.letterHeader}>{letter}</Text>
                {groupedContacts[letter].map((contact) => (
                  <TouchableOpacity
                    key={contact.id}
                    activeOpacity={0.7}
                    onPress={() => startCall(contact)}
                    style={styles.contactRow}
                  >
                    <View style={styles.contactLeft}>
                      <View style={styles.contactAvatarWrapper}>
                        <LinearGradient colors={contact.colors} style={styles.contactAvatar}>
                          <Text style={styles.contactAvatarText}>{contact.initials}</Text>
                        </LinearGradient>
                        {contact.isOnline && <View style={styles.contactOnlineBadge} />}
                      </View>

                      <View style={styles.contactMeta}>
                        <Text style={styles.contactName}>{contact.name}</Text>
                        <Text style={styles.contactSubtext}>
                          {contact.number || contact.handle}
                        </Text>
                      </View>
                    </View>

                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => startCall(contact)}
                      style={styles.shieldBtn}
                    >
                      <Ionicons name="shield-checkmark-outline" size={18} color="#3B82F6" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </ScrollView>
        )}

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
    paddingVertical: 12,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  permissionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderRadius: 18,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.25)',
  },
  permTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  permSub: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181B',
    borderRadius: 20,
    paddingHorizontal: 16,
    height: 50,
    marginVertical: 8,
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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 12,
  },
  scrollContent: {
    paddingTop: 8,
  },
  sectionHeading: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginVertical: 10,
  },
  favoritesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  favoriteCard: {
    flex: 1,
    backgroundColor: '#131316',
    borderRadius: 24,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  favAvatarContainer: {
    position: 'relative',
    marginBottom: 6,
  },
  favAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  favAvatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  favOnlineBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22C55E',
    borderWidth: 2,
    borderColor: '#131316',
  },
  favName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  favCallBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupContainer: {
    marginBottom: 14,
  },
  letterHeader: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#131316',
    borderRadius: 20,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  contactLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  contactAvatarWrapper: {
    position: 'relative',
    marginRight: 12,
  },
  contactAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactAvatarText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  contactOnlineBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22C55E',
    borderWidth: 2,
    borderColor: '#131316',
  },
  contactMeta: {
    flex: 1,
  },
  contactName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  contactSubtext: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  shieldBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
});
