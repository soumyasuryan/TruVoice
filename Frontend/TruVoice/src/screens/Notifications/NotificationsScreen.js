import React, { useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FloatingCallButton from '../../components/buttons/FloatingCallButton';
import { ROUTES } from '../../constants/routes';
import { colors } from '../../theme';
import { safeGoBack } from '../../utils/navigationHelper';

// Real notifications will be populated from backend push/socket events
// No hardcoded dummy data
const MOCK_NOTIFICATIONS = [];

export default function NotificationsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState(MOCK_NOTIFICATIONS);

  const unreadCount = notifications.filter((item) => !item.read).length;

  const handleMarkAllRead = () => {
    setNotifications((prev) =>
      prev.map((item) => ({ ...item, read: true })),
    );
  };

  const handleNotificationPress = (item) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)),
    );
    if (item.targetRoute) {
      navigation.navigate(item.targetRoute, {
        ...(item.targetParams || {}),
      });
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <TouchableOpacity
              onPress={() => safeGoBack(navigation, ROUTES.MAIN_TABS)}
              style={styles.backBtn}
            >
              <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
            </TouchableOpacity>

            {unreadCount > 0 ? (
              <TouchableOpacity onPress={handleMarkAllRead} style={styles.newBadge}>
                <Text style={styles.newBadgeText}>{unreadCount} new</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.readBadge}>
                <Text style={styles.readBadgeText}>All read</Text>
              </View>
            )}
          </View>

          <Text style={styles.title}>Notifications</Text>
          <Text style={styles.subtitle}>Security alerts and activity</Text>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom + 110, 120) },
          ]}
        >
          {/* Alert Cards */}
          {notifications.map((item) => (
            <TouchableOpacity
              key={item.id}
              activeOpacity={0.7}
              onPress={() => handleNotificationPress(item)}
              style={[
                styles.alertCard,
                !item.read && styles.alertCardUnread,
              ]}
            >
              <View style={[styles.iconBox, { backgroundColor: item.iconBg }]}>
                <Ionicons name={item.icon} size={22} color={item.iconColor} />
              </View>

              <View style={styles.cardContent}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardTime}>{item.time}</Text>
                </View>
                <Text style={styles.cardDesc}>{item.description}</Text>
              </View>
            </TouchableOpacity>
          ))}

          {/* Caught up section */}
          <View style={styles.caughtUpContainer}>
            <View style={styles.starBox}>
              <Ionicons name="star-outline" size={28} color={colors.textMuted} />
            </View>
            <Text style={styles.caughtUpTitle}>You’re all caught up</Text>
            <Text style={styles.caughtUpSubtitle}>
              New alerts appear here the moment a risk is detected.
            </Text>
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
    paddingVertical: 14,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  newBadgeText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '700',
  },
  readBadge: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  readBadgeText: {
    color: '#22C55E',
    fontSize: 12,
    fontWeight: '600',
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
  scrollContent: {
    paddingTop: 8,
  },
  alertCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#131316',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  alertCardUnread: {
    borderColor: 'rgba(59, 130, 246, 0.3)',
    backgroundColor: '#16161B',
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  cardContent: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  cardTime: {
    color: colors.textMuted,
    fontSize: 12,
  },
  cardDesc: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  caughtUpContainer: {
    alignItems: 'center',
    marginTop: 40,
    paddingHorizontal: 20,
  },
  starBox: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#131316',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  caughtUpTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  caughtUpSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});
