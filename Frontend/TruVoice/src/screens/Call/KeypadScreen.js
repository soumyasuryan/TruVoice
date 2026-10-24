import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ROUTES } from '../../constants/routes';
import { useContactsStore } from '../../store/contactsStore';
import { colors } from '../../theme';
import { safeGoBack } from '../../utils/navigationHelper';
import { normalizePhoneNumber } from '../../utils/analysisMapper';

const DIAL_KEYS = [
  { key: '1', sub: ' ' },
  { key: '2', sub: 'A B C' },
  { key: '3', sub: 'D E F' },
  { key: '4', sub: 'G H I' },
  { key: '5', sub: 'J K L' },
  { key: '6', sub: 'M N O' },
  { key: '7', sub: 'P Q R S' },
  { key: '8', sub: 'T U V' },
  { key: '9', sub: 'W X Y Z' },
  { key: '*', sub: '' },
  { key: '0', sub: '+' },
  { key: '#', sub: '' },
];

export default function KeypadScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [phoneNumber, setPhoneNumber] = useState('');
  const contacts = useContactsStore((state) => state.contacts);
  const loadContacts = useContactsStore((state) => state.loadContacts);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const matchedContacts = phoneNumber
    ? contacts
        .filter((c) => {
          const cleanPhone = normalizePhoneNumber(c.number || c.phone_number || c.phone || '');
          const cleanInput = normalizePhoneNumber(phoneNumber);
          return cleanInput && cleanPhone && cleanPhone.includes(cleanInput);
        })
        .map((c) => ({
          id: c.id,
          name: c.name,
          number: c.number,
          initials: c.initials || (c.name || 'U').substring(0, 2).toUpperCase(),
          colors: c.colors,
        }))
    : [];

  const handleKeyPress = (key) => {
    if (phoneNumber.length < 15) {
      setPhoneNumber((prev) => prev + key);
    }
  };

  const handleDelete = () => {
    setPhoneNumber((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    setPhoneNumber('');
  };

  const handleBackspace = () => {
    handleDelete();
  };

  const handleLongDelete = () => {
    setPhoneNumber('');
  };

  const handleCall = (selectedContact) => {
    let targetContact;
    if (selectedContact) {
      targetContact = {
        name: selectedContact.name,
        number: selectedContact.number,
        initials: selectedContact.initials || 'U',
        userId: selectedContact.id,
      };
    } else {
      if (!phoneNumber) return;

      const matchedContact = contacts.find((c) => {
        const cleanPhone = normalizePhoneNumber(c.number || c.phone_number || c.phone || '');
        const cleanInput = normalizePhoneNumber(phoneNumber);
        return (
          (cleanPhone && cleanInput && cleanPhone.includes(cleanInput)) ||
          (c.email && c.email.toLowerCase() === phoneNumber.trim().toLowerCase())
        );
      });

      targetContact = matchedContact
        ? {
            name: matchedContact.name,
            number: matchedContact.number,
            initials: matchedContact.initials || (matchedContact.name || 'U').substring(0, 2).toUpperCase(),
            userId: matchedContact.id,
          }
        : {
            name: phoneNumber,
            number: phoneNumber,
            initials: 'P',
            userId: phoneNumber,
          };
    }

    navigation.navigate(ROUTES.OUTGOING_CALL, { contact: targetContact });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />
      <View style={[styles.container, { paddingBottom: Math.max(insets.bottom + 16, 24) }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => safeGoBack(navigation, ROUTES.MAIN_TABS)}
            style={styles.backBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Dialer</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* Dynamic Matches List */}
        <View style={styles.matchesContainer}>
          {phoneNumber.length > 0 && (
            <FlatList
              data={matchedContacts}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => handleCall(item)}
                  style={styles.contactRow}
                >
                  <LinearGradient colors={item.colors || ['#3B82F6', '#6366F1']} style={styles.avatar}>
                    <Text style={styles.avatarText}>{item.initials}</Text>
                  </LinearGradient>
                  <View style={styles.contactMeta}>
                    <Text style={styles.contactName}>{item.name}</Text>
                    <Text style={styles.contactNumber}>{item.number}</Text>
                  </View>
                  <Ionicons name="call-outline" size={18} color="#3B82F6" />
                </TouchableOpacity>
              )}
              ListEmptyComponent={() => (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => handleCall()}
                  style={styles.contactRow}
                >
                  <View style={[styles.avatar, { backgroundColor: '#18181B' }]}>
                    <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                  </View>
                  <View style={styles.contactMeta}>
                    <Text style={styles.contactName}>Unknown Caller</Text>
                    <Text style={styles.contactNumber}>Dial {phoneNumber}</Text>
                  </View>
                  <Ionicons name="call-outline" size={18} color="#3B82F6" />
                </TouchableOpacity>
              )}
            />
          )}
        </View>

        {/* Display Field */}
        <View style={styles.displayArea}>
          <Text style={styles.displayText} numberOfLines={1} adjustsFontSizeToFit>
            {phoneNumber || ' '}
          </Text>
          {phoneNumber.length > 0 && (
            <TouchableOpacity onPress={handleClear} style={styles.clearBtn}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Keypad Grid */}
        <View style={styles.grid}>
          {DIAL_KEYS.map((k) => (
            <TouchableOpacity
              key={k.key}
              activeOpacity={0.5}
              onPress={() => handleKeyPress(k.key)}
              style={styles.key}
            >
              <Text style={styles.keyText}>{k.key}</Text>
              <Text style={styles.subText}>{k.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Bottom Actions Row */}
        <View style={styles.actionsRow}>
          <View style={{ width: 68 }} />

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => handleCall()}
            disabled={!phoneNumber}
            style={[styles.callBtn, !phoneNumber && styles.callBtnDisabled]}
          >
            <Ionicons name="call" size={28} color="#FFFFFF" />
          </TouchableOpacity>

          {phoneNumber.length > 0 ? (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleBackspace}
              onLongPress={handleClear}
              style={styles.backspaceBtn}
            >
              <Ionicons name="backspace-outline" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 68 }} />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  container: {
    flex: 1,
    backgroundColor: '#09090B',
    paddingHorizontal: 20,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 40,
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
  matchesContainer: {
    height: 120,
    marginVertical: 4,
    justifyContent: 'center',
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  contactMeta: {
    flex: 1,
  },
  contactName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  contactNumber: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  displayArea: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 70,
    marginBottom: 8,
    position: 'relative',
  },
  displayText: {
    color: '#FFFFFF',
    fontSize: 38,
    fontWeight: '600',
    letterSpacing: 1,
    width: '100%',
    textAlign: 'center',
  },
  clearBtn: {
    position: 'absolute',
    bottom: -16,
  },
  clearText: {
    color: '#3B82F6',
    fontSize: 13,
    fontWeight: '500',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
    marginVertical: 12,
  },
  key: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#131316',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  keyText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '400',
  },
  subText: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '600',
    marginTop: 1,
    letterSpacing: 0.5,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 8,
  },
  callBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  callBtnDisabled: {
    backgroundColor: '#1E3A27',
    opacity: 0.6,
  },
  backspaceBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
