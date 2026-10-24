import { create } from 'zustand';
import { api, setAuthToken } from '../services/api/client';
import { tokenStorage } from '../services/storage/tokenStorage';
import { agoraService } from '../services/agora/agoraService';

export const useAuthStore = create((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  isHydrated: false,
  hasOnboarded: false,
  pendingPhone: null,
  pendingEmail: null,
  otpPurpose: 'signup',

  setLoading: (loading) => set({ isLoading: loading }),

  hydrate: async () => {
    try {
      const [token, user, hasOnboarded] = await Promise.all([
        tokenStorage.getToken(),
        tokenStorage.getUser(),
        tokenStorage.getOnboarded(),
      ]);

      if (token) {
        setAuthToken(token);
        set({
          token,
          user,
          isAuthenticated: true,
          hasOnboarded,
          isHydrated: true,
        });
        if (user?.id) {
          agoraService.init(user.id, token);
        }
        return;
      }
    } catch (error) {
      console.warn('Auth hydrate failed:', error.message);
    }

    set({ isHydrated: true, hasOnboarded: false });
  },

  setHasOnboarded: async (value) => {
    await tokenStorage.setOnboarded(value);
    set({ hasOnboarded: value });
  },

  _persistSession: async (accessToken, user) => {
    setAuthToken(accessToken);
    await tokenStorage.saveSession(accessToken, user);
    set({
      token: accessToken,
      user,
      isAuthenticated: true,
      isLoading: false,
      pendingPhone: null,
      pendingEmail: null,
    });
    if (user?.id) {
      agoraService.init(user.id, accessToken);
    }
  },


  initiateSignup: async ({ name, age, email, phone_number, password }) => {
    set({ isLoading: true });
    try {
      const response = await api.signupInitiate({
        name,
        age: Number(age),
        email,
        phone_number,
        password,
      });

      set({
        isLoading: false,
        pendingPhone: phone_number,
        pendingEmail: email,
        otpPurpose: 'signup',
        user: { name, email, phone_number },
      });

      return response.data;
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  verifySignup: async (otp) => {
    const phone_number = get().pendingPhone;
    if (!phone_number) throw new Error('Missing phone number for verification.');

    set({ isLoading: true });
    try {
      const response = await api.signupVerify({
        phone_number,
        otp,
        purpose: 'signup',
      });

      const { access_token, user_id, phone_number: phone } = response.data;
      const existingUser = get().user || {};

      await get()._persistSession(access_token, {
        id: user_id,
        name: existingUser.name || 'TruVoice User',
        email: existingUser.email || '',
        phone_number: phone,
      });

      return response.data;
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  initiateLogin: async ({ phone_number, password }) => {
    set({ isLoading: true });
    try {
      const response = await api.loginInitiate({ phone_number, password });
      set({
        isLoading: false,
        pendingPhone: phone_number,
        otpPurpose: 'login',
      });
      return response.data;
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  verifyLogin: async (otp) => {
    const phone_number = get().pendingPhone;
    if (!phone_number) throw new Error('Missing phone number for verification.');

    set({ isLoading: true });
    try {
      const response = await api.loginVerify({
        phone_number,
        otp,
        purpose: 'login',
      });

      const { access_token, user_id, phone_number: phone } = response.data;

      await get()._persistSession(access_token, {
        id: user_id,
        name: get().user?.name || 'TruVoice User',
        email: get().user?.email || '',
        phone_number: phone,
      });

      return response.data;
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  resendOtp: async () => {
    const phone_number = get().pendingPhone;
    const purpose = get().otpPurpose;
    if (!phone_number) throw new Error('Missing phone number.');

    set({ isLoading: true });
    try {
      const response = await api.resendOtp({ phone_number, purpose });
      set({ isLoading: false });
      return response.data;
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    try {
      await api.logout();
    } catch {
      // still clear local session if backend logout fails
    }

    setAuthToken(null);
    await tokenStorage.clearSession();

    set({
      token: null,
      user: null,
      isAuthenticated: false,
      pendingPhone: null,
      pendingEmail: null,
    });
  },
}));

export default useAuthStore;
