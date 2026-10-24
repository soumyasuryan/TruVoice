import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = '@truvoice_token';
const USER_KEY = '@truvoice_user';
const ONBOARDED_KEY = '@truvoice_onboarded';

export const tokenStorage = {
  saveSession: async (token, user) => {
    await AsyncStorage.multiSet([
      [TOKEN_KEY, token],
      [USER_KEY, JSON.stringify(user)],
    ]);
  },

  getToken: async () => AsyncStorage.getItem(TOKEN_KEY),

  getUser: async () => {
    const raw = await AsyncStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },

  clearSession: async () => {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
  },

  setOnboarded: async (value) => {
    await AsyncStorage.setItem(ONBOARDED_KEY, value ? '1' : '0');
  },

  getOnboarded: async () => {
    const value = await AsyncStorage.getItem(ONBOARDED_KEY);
    return value === '1';
  },
};

export default tokenStorage;
