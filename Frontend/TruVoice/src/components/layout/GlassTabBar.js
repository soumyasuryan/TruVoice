import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme';

export default function GlassTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  const bottomPosition = Math.max(insets.bottom + 8, 16);

  const getIconName = (routeName, isFocused) => {
    switch (routeName) {
      case 'Home':
        return isFocused ? 'home' : 'home-outline';
      case 'Calls':
        return isFocused ? 'people' : 'people-outline';
      case 'History':
        return isFocused ? 'time' : 'time-outline';
      case 'Settings':
        return isFocused ? 'settings' : 'settings-outline';
      default:
        return 'ellipse-outline';
    }
  };

  const getLabel = (routeName) => {
    switch (routeName) {
      case 'Home':
        return 'Home';
      case 'Calls':
        return 'Calls';
      case 'History':
        return 'History';
      case 'Settings':
        return 'Settings';
      default:
        return routeName;
    }
  };

  return (
    <View style={[styles.container, { bottom: bottomPosition }]} pointerEvents="box-none">
      <View style={styles.tabBarWrapper}>
        <BlurView intensity={Platform.OS === 'ios' ? 40 : 80} tint="dark" style={styles.blurContainer}>
          <View style={styles.tabBarInner}>
            {state.routes.map((route, index) => {
              const { options } = descriptors[route.key];
              const isFocused = state.index === index;

              const onPress = () => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });

                if (!isFocused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              };

              const onLongPress = () => {
                navigation.emit({
                  type: 'tabLongPress',
                  target: route.key,
                });
              };

              const iconName = getIconName(route.name, isFocused);
              const label = getLabel(route.name);

              return (
                <TouchableOpacity
                  key={route.key}
                  accessibilityRole="button"
                  accessibilityState={isFocused ? { selected: true } : {}}
                  accessibilityLabel={options.tabBarAccessibilityLabel}
                  testID={options.tabBarTestID}
                  onPress={onPress}
                  onLongPress={onLongPress}
                  activeOpacity={0.7}
                  style={styles.tabItem}
                >
                  <View style={[styles.iconWrapper, isFocused && styles.activeIconWrapper]}>
                    <Ionicons
                      name={iconName}
                      size={20}
                      color={isFocused ? '#60A5FA' : colors.textMuted}
                    />
                    <Text
                      style={[
                        styles.tabLabel,
                        { color: isFocused ? '#60A5FA' : colors.textMuted, fontWeight: isFocused ? '600' : '400' },
                      ]}
                    >
                      {label}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </BlurView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 20,
    right: 20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  tabBarWrapper: {
    width: '100%',
    borderRadius: 36,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(15, 15, 18, 0.88)',
  },
  blurContainer: {
    width: '100%',
    borderRadius: 36,
    overflow: 'hidden',
  },
  tabBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    overflow: 'hidden',
  },
  activeIconWrapper: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderRadius: 20,
    overflow: 'hidden',
  },
  tabLabel: {
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
    includeFontPadding: false,
  },
});
