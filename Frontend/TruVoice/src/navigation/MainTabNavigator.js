import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import GlassTabBar from '../components/layout/GlassTabBar';
import HomeScreen from '../screens/Home/HomeScreen';
import OnlineUsersScreen from '../screens/Contacts/OnlineUsersScreen';
import HistoryScreen from '../screens/History/HistoryScreen';
import SettingsScreen from '../screens/Settings/SettingsScreen';

const Tab = createBottomTabNavigator();

export default function MainTabNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: '#09090B' },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Calls" component={OnlineUsersScreen} />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

