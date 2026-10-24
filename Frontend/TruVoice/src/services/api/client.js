import axios from 'axios';
import { config, ENDPOINTS } from '../../constants/config';
import { getApiErrorMessage } from '../../utils/apiError';

const apiClient = axios.create({
  baseURL: config.apiBaseUrl,
  timeout: config.apiTimeout,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const setAuthToken = (token) => {
  if (token) {
    apiClient.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete apiClient.defaults.headers.common.Authorization;
  }
};

apiClient.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(new Error(getApiErrorMessage(error))),
);

export const api = {
  healthCheck: () => apiClient.get(ENDPOINTS.health),

  signupInitiate: (payload) =>
    apiClient.post(ENDPOINTS.signupInitiate, payload),

  signupVerify: (payload) =>
    apiClient.post(ENDPOINTS.signupVerify, payload),

  loginInitiate: (payload) =>
    apiClient.post(ENDPOINTS.loginInitiate, payload),

  loginVerify: (payload) =>
    apiClient.post(ENDPOINTS.loginVerify, payload),

  resendOtp: (payload) =>
    apiClient.post(ENDPOINTS.resendOtp, payload),

  logout: () => apiClient.post(ENDPOINTS.logout),

  analyzeAudio: (fileUri, callerNumber) => {
    if (!fileUri) {
      return Promise.reject(new Error('Audio file is missing.'));
    }

    const isValidAudio = /\.(m4a|mp3|wav|aac|flac)($|\?)/i.test(fileUri) || /truvoice_chunk/i.test(fileUri);
    if (!isValidAudio) {
      return Promise.reject(
        new Error('Invalid audio format. Provide M4A, MP3, WAV, AAC, or FLAC files.'),
      );
    }

    if (!callerNumber || !String(callerNumber).trim()) {
      return Promise.reject(new Error('Caller number is required for analysis.'));
    }

    let mimeType = 'audio/m4a';
    if (/\.mp3($|\?)/i.test(fileUri)) mimeType = 'audio/mpeg';
    else if (/\.wav($|\?)/i.test(fileUri)) mimeType = 'audio/wav';
    else if (/\.flac($|\?)/i.test(fileUri)) mimeType = 'audio/flac';

    const ext = mimeType.split('/')[1] || 'm4a';
    const fileName = /[^/\\]+\.(m4a|mp3|wav|aac|flac)$/i.exec(fileUri)?.[0] || `truvoice_chunk_${Date.now()}.${ext}`;

    const formData = new FormData();
    formData.append('file', {
      uri: fileUri,
      type: mimeType,
      name: fileName,
    });
    formData.append('caller_number', String(callerNumber).trim());

    return apiClient.post(ENDPOINTS.analyze, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    });
  },

  analyzeAudioBase64: (audioBase64, callerNumber, callId) => {
    if (!audioBase64) {
      return Promise.reject(new Error('Audio base64 data is missing.'));
    }
    return apiClient.post(
      ENDPOINTS.analysisAudioBase64,
      {
        audio_base64: audioBase64,
        caller_number: callerNumber ? String(callerNumber).trim() : null,
        call_id: callId || null,
      },
      { timeout: 120000 },
    );
  },

  getAnalysisHistory: () => apiClient.get(ENDPOINTS.analysisHistory),

  getSpamStatus: (phoneNumber) =>
    apiClient.get(ENDPOINTS.spamStatus(phoneNumber)),

  reportSpam: (phoneNumber) =>
    apiClient.post(ENDPOINTS.spamReports, { phone_number: phoneNumber }),

  submitScamComplaint: (phoneNumber, description) =>
    apiClient.post(ENDPOINTS.scamComplaints, {
      phone_number: phoneNumber,
      description,
    }),

  // Agora Voice Calling API
  getAgoraToken: (channelName) =>
    apiClient.post(ENDPOINTS.voiceToken, { channelName }),

  logCall: (channelName, targetUserId, targetPhoneNumber) =>
    apiClient.post(ENDPOINTS.voiceLogCall, {
      channelName,
      targetUserId,
      targetPhoneNumber: targetPhoneNumber || null,
    }),

  updateCallStatus: (callId, status, duration = 0) =>
    apiClient.post(ENDPOINTS.voiceUpdateCall, { call_id: callId, status, duration }),

  getAppUsers: () => apiClient.get(ENDPOINTS.voiceUsers),

  getVoiceCalls: () => apiClient.get(ENDPOINTS.voiceCalls),

  getPendingCall: () => apiClient.get(ENDPOINTS.voicePendingCall),

  getVoiceCallDetail: (callId) => apiClient.get(ENDPOINTS.voiceCallDetail(callId)),

  getGuardianSettings: () => apiClient.get(ENDPOINTS.guardianSettings),

  updateGuardianSettings: (enabled) =>
    apiClient.put(ENDPOINTS.guardianSettings, { enabled }),

  getGuardianContacts: () => apiClient.get(ENDPOINTS.guardianContacts),

  addGuardianContact: (email) =>
    apiClient.post(ENDPOINTS.guardianContacts, { email }),

  removeGuardianContact: (contactId) =>
    apiClient.delete(ENDPOINTS.guardianContact(contactId)),
};




export default apiClient;
