import { Platform } from 'react-native';
import Constants from 'expo-constants';
// this is config 
const appConfigApiUrl =
  Constants.expoConfig?.extra?.apiUrl ||
  Constants.manifest?.extra?.apiUrl;
const envApiUrl =
  appConfigApiUrl ||
  process.env.EXPO_PUBLIC_API_URL ||
  process.env.REACT_NATIVE_API_URL ||
  process.env.API_URL ||
  process.env.NEXT_PUBLIC_API_URL;

const hostUri = Constants.expoConfig?.hostUri || Constants.manifest?.debuggerHost;
const inferredHostIp = hostUri ? hostUri.split(':')[0] : null;

const DEFAULT_API_BASE_URL = envApiUrl
  ? envApiUrl
  : inferredHostIp
  ? `http://${inferredHostIp}:8000`
  : Platform.OS === 'android'
  ? 'http://10.0.2.2:8000'
  : 'http://localhost:8000';

const DEFAULT_WS_BASE_URL = DEFAULT_API_BASE_URL
  .replace(/^http:/, 'ws:')
  .replace(/^https:/, 'wss:');

export const config = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  wsBaseUrl: DEFAULT_WS_BASE_URL,
  // Never silently use a placeholder: both callers must use the App ID from
  // the same Agora project as the token-generating backend.
  agoraAppId: process.env.EXPO_PUBLIC_AGORA_APP_ID || Constants.expoConfig?.extra?.agoraAppId || '',
  apiTimeout: 60000,
  splashDuration: 2500,
  onboardingSlides: 3,
  audioChunkIntervalMs: 20000,
  otpResendCooldownSec: 60,
  maxTranscriptLines: 100,
  historyLimit: 30,
};

export const ENDPOINTS = {
  health: '/',
  signupInitiate: '/auth/signup/initiate',
  signupVerify: '/auth/signup/verify',
  loginInitiate: '/auth/login/initiate',
  loginVerify: '/auth/login/verify',
  resendOtp: '/auth/resend-otp',
  logout: '/auth/logout',
  analyze: '/api/v1/analyze',
  analysisAudioBase64: '/api/v1/analysis/audio',
  analysisHistory: '/api/v1/analysis-history',
  spamStatus: (phone) =>
    `/api/v1/spam-status/${encodeURIComponent(phone)}`,
  spamReports: '/api/v1/spam-reports',
  scamComplaints: '/api/v1/scam-complaints',

  voiceToken: '/api/v1/voice/token',
  voiceLogCall: '/api/v1/voice/log-call',
  voiceUpdateCall: '/api/v1/voice/update-call',
  voiceUsers: '/api/v1/voice/users',
  voiceCalls: '/api/v1/voice/calls',
  voicePendingCall: '/api/v1/voice/pending-call',
  voiceCallDetail: (id) => `/api/v1/voice/calls/${encodeURIComponent(id)}`,
  guardianSettings: '/api/v1/guardian-alerts/settings',
  guardianContacts: '/api/v1/guardian-alerts/contacts',
  guardianContact: (id) => `/api/v1/guardian-alerts/contacts/${encodeURIComponent(id)}`,
  wsSignaling: (token) =>
    `${DEFAULT_WS_BASE_URL}/ws/signaling?token=${encodeURIComponent(token)}`,
  wsLiveAnalysis: (callId, token) =>
    `${DEFAULT_WS_BASE_URL}/ws/live-analysis/${callId}?token=${encodeURIComponent(token)}`,
};



export default config;
