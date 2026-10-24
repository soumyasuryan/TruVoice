import { create } from 'zustand';

export const CALL_STATUS = {
  IDLE: 'idle',
  INVITING: 'inviting',
  INCOMING: 'incoming',
  OUTGOING: 'outgoing',
  RINGING: 'ringing',
  CONNECTING: 'connecting',
  ACTIVE: 'active',
  ENDED: 'ended',
  DECLINED: 'declined',
  BUSY: 'busy',
};

export const useCallStore = create((set, get) => ({
  callId: null,
  channelName: null,
  targetUserId: null,
  callerUser: null,
  phoneNumber: null,
  incomingCall: null,

  status: CALL_STATUS.IDLE,
  connectionState: 'disconnected',
  activeCall: null,

  callDuration: 0,

  trustScore: null,
  confidence: null,
  riskLevel: null,

  isScam: null,
  isAIVoice: null,
  threatType: null,
  uiAlert: null,

  transcript: '',
  signals: [],
  riskAlert: null,

  isMuted: false,
  isSpeakerOn: false,
  isVideoEnabled: false,
  error: null,

  // Actions
  setCallId: (callId) => set({ callId }),
  setChannelName: (channelName) => set({ channelName }),
  setTargetUserId: (targetUserId) => set({ targetUserId }),
  setCallerUser: (callerUser) => set({ callerUser }),
  setPhoneNumber: (phoneNumber) => set({ phoneNumber }),
  setIncomingCall: (incomingCall) => set({ incomingCall, status: CALL_STATUS.INCOMING, error: null }),
  clearIncomingCall: () => set({ incomingCall: null, status: CALL_STATUS.IDLE, error: null }),

  setStatus: (status) => set({ status }),
  setConnectionState: (connectionState) => set({ connectionState }),
  setActiveCall: (activeCall) => set({ activeCall }),
  setCallDuration: (callDuration) => set({ callDuration }),
  incrementDuration: () => set({ callDuration: get().callDuration + 1 }),

  setCallData: (data) => set((state) => ({ ...state, ...data })),
  setRiskAlert: (riskAlert) => set({ riskAlert }),

  toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),
  toggleSpeaker: () => set((state) => ({ isSpeakerOn: !state.isSpeakerOn })),
  toggleVideo: () => set((state) => ({ isVideoEnabled: !state.isVideoEnabled })),

  setError: (error) => set({ error }),

  resetCall: () =>
    set({
      callId: null,
      channelName: null,
      targetUserId: null,
      callerUser: null,
      phoneNumber: null,
      incomingCall: null,
      status: CALL_STATUS.IDLE,
      connectionState: 'disconnected',
      activeCall: null,
      callDuration: 0,
      trustScore: null,
      confidence: null,
      riskLevel: null,
      isScam: null,
      isAIVoice: null,
      threatType: null,
      uiAlert: null,
      transcript: '',
      signals: [],
      riskAlert: null,
      isMuted: false,
      isSpeakerOn: false,
      isVideoEnabled: false,
      error: null,
    }),
}));

export default useCallStore;
