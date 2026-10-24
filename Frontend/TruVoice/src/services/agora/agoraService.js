import { Platform, PermissionsAndroid } from 'react-native';
import { Audio } from 'expo-av';
import { config, ENDPOINTS } from '../../constants/config';
import { api } from '../api/client';
import { useCallStore } from '../../store/callStore';

class AgoraService {
  constructor() {
    this.appId = config.agoraAppId;
    this.rtcEngine = null;
    this.rtmClient = null;
    this.currentChannel = null;
    this.isLoggedIn = false;
    this.isEngineReady = false;
    this.userId = null;
    this.eventListeners = {};
    this.ws = null;
    this.pollerInterval = null;
    this.pingInterval = null;
    this.reconnectTimer = null;
    this.authToken = null;
    this.remoteUsers = new Set();
    this.handledCallIds = new Set();
    this.pendingEndCallIds = new Set();
    this.lastCallActionById = new Map();
  }

  shouldHandleCallAction(callId, action) {
    const callKey = String(callId || '');
    const normalizedAction = String(action || '').toLowerCase();
    if (!callKey || !normalizedAction) return true;

    const previousAction = this.lastCallActionById.get(callKey);
    if (!previousAction) {
      this.lastCallActionById.set(callKey, normalizedAction);
      return true;
    }

    const terminalActions = new Set(['ended', 'declined', 'canceled', 'busy', 'no-answer', 'no_answer']);
    if (previousAction === normalizedAction) {
      return false;
    }

    if (previousAction === 'answered' && terminalActions.has(normalizedAction)) {
      const currentStatus = String(useCallStore.getState().status || '').toLowerCase();
      if (currentStatus !== 'active') {
        console.warn(`Ignoring stale terminal action ${normalizedAction} before call became active for ${callKey}`);
        return false;
      }
    }

    this.lastCallActionById.set(callKey, normalizedAction);
    return true;
  }

  markCallHandled(callId) {
    if (callId) {
      this.handledCallIds.add(String(callId));
    }
  }

  async requestMicrophonePermission() {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        );
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          return true;
        }
      }
      const { status } = await Audio.requestPermissionsAsync();
      return status === 'granted';
    } catch (e) {
      console.warn('Microphone permission request failed:', e);
      return false;
    }
  }

  _assertAgoraSuccess(methodName, result) {
    if (typeof result === 'number' && result < 0) {
      console.warn(`Agora: ${methodName} returned code ${result}`);
    }
    return result;
  }

  _enableRemoteAudio(remoteUid = null) {
    if (!this.rtcEngine) return;

    const enable = () => {
      try {
        if (remoteUid !== null && typeof this.rtcEngine.muteRemoteAudioStream === 'function') {
          this.rtcEngine.muteRemoteAudioStream(remoteUid, false);
          console.log(`Agora: unmuted remote audio stream uid=${remoteUid}`);
        }
        if (remoteUid !== null && typeof this.rtcEngine.adjustUserPlaybackSignalVolume === 'function') {
          this.rtcEngine.adjustUserPlaybackSignalVolume(remoteUid, 100);
        }
        if (typeof this.rtcEngine.muteAllRemoteAudioStreams === 'function') {
          this.rtcEngine.muteAllRemoteAudioStreams(false);
        }
        if (typeof this.rtcEngine.adjustPlaybackSignalVolume === 'function') {
          this.rtcEngine.adjustPlaybackSignalVolume(100);
        }
        if (typeof this.rtcEngine.setEnableSpeakerphone === 'function') {
          this.rtcEngine.setEnableSpeakerphone(true);
        }
        if (typeof this.rtcEngine.setDefaultAudioRouteToSpeakerphone === 'function') {
          this.rtcEngine.setDefaultAudioRouteToSpeakerphone(true);
        }
      } catch (e) {
        console.warn('Agora: unable to enable remote audio playback', e);
      }
    };

    // Immediate attempt
    enable();
    setTimeout(enable, 500);
    setTimeout(enable, 1500);
  }

  _registerRtcEventHandlers() {
    if (!this.rtcEngine || typeof this.rtcEngine.registerEventHandler !== 'function') return;

    this.rtcEngine.registerEventHandler({
      onJoinChannelSuccess: (connection, elapsed) => {
        console.log(
          `Agora: joined channel ${connection?.channelId || this.currentChannel} ` +
          `uid=${connection?.localUid ?? this.userId} (${elapsed}ms)`,
        );
        useCallStore.getState().setConnectionState('connected');
        this.emit('channel_joined', { channelName: connection?.channelId || this.currentChannel });
      },
      onUserJoined: (connection, remoteUid, elapsed) => {
        console.log(`Agora: remote user ${remoteUid} joined (${elapsed}ms)`);
        this.remoteUsers.add(remoteUid);
        this._enableRemoteAudio(remoteUid);
        useCallStore.getState().setConnectionState('connected');
        this.emit('remote_user_joined', { uid: remoteUid, channelName: connection?.channelId });
      },
      onAudioVolumeIndication: (connection, speakers) => {
        if (Array.isArray(speakers) && speakers.length > 0) {
          const details = speakers.map((s) => `${s.uid === 0 ? 'local' : `uid=${s.uid}`}:vol=${s.volume}`).join(', ');
          console.log(`Agora: audio volume indication (${speakers.length} speaker(s): ${details})`);
        }
      },
      onLocalAudioStateChanged: (connection, state, reason) => {
        console.log(`Agora: local audio state=${state} reason=${reason}`);
        this.emit('local_audio_state_changed', { state, reason });
      },
      onUserOffline: (connection, remoteUid, reason) => {
        console.log(`Agora: remote user ${remoteUid} offline (reason ${reason})`);
        this.remoteUsers.delete(remoteUid);
        if (this.remoteUsers.size === 0) {
          useCallStore.getState().setConnectionState('disconnected');
        }
        this.emit('remote_user_left', { uid: remoteUid, reason });
      },
      onRemoteAudioStateChanged: (connection, remoteUid, state, reason, elapsed) => {
        console.log(`Agora: remote audio uid=${remoteUid} state=${state} reason=${reason}`);
        if (state === 0 || state === 2) {
          this._enableRemoteAudio(remoteUid);
        }
        if (state === 2) {
          this.emit('remote_audio_started', { uid: remoteUid });
        }
      },
      onError: (err, msg) => {
        console.warn(`Agora RTC error ${err}: ${msg}`);
        this.emit('rtc_error', { err, msg });
      },
      onLeaveChannel: (connection, stats) => {
        console.log('Agora: left channel');
        this.remoteUsers.clear();
        useCallStore.getState().setConnectionState('disconnected');
      },
    });
  }

  async init(userId, authToken) {
    if (!userId) return;

    const normalizedUserId = String(userId);
    const sameSession = this.isLoggedIn && this.userId === normalizedUserId && this.authToken === authToken;
    if (sameSession && this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.userId = normalizedUserId;
    if (authToken) this.authToken = authToken;

    try {
      try {
        if (!this.appId) {
          throw new Error('Missing EXPO_PUBLIC_AGORA_APP_ID. Set it to the App ID used by the backend.');
        }
        const { createAgoraRtcEngine, ChannelProfileType, ClientRoleType } = require('react-native-agora');
        this.rtcEngine = createAgoraRtcEngine();
        this.rtcEngine.initialize({ appId: this.appId });
        this._registerRtcEventHandlers();

        if (typeof this.rtcEngine.setChannelProfile === 'function') {
          this.rtcEngine.setChannelProfile(ChannelProfileType?.ChannelProfileCommunication ?? 0);
        }
        if (typeof this.rtcEngine.setClientRole === 'function') {
          this.rtcEngine.setClientRole(ClientRoleType?.ClientRoleBroadcaster ?? 1);
        }
        this.rtcEngine.enableAudio();
        if (typeof this.rtcEngine.enableLocalAudio === 'function') {
          this.rtcEngine.enableLocalAudio(true);
        }
        if (typeof this.rtcEngine.setDefaultAudioRouteToSpeakerphone === 'function') {
          this.rtcEngine.setDefaultAudioRouteToSpeakerphone(true);
        }
        // Enable volume callbacks globally so onAudioVolumeIndication fires for
        // both local and remote peers even before joinChannel is called.
        if (typeof this.rtcEngine.enableAudioVolumeIndication === 'function') {
          try {
            this.rtcEngine.enableAudioVolumeIndication(200, 3, true);
          } catch (_) {}
        }
        this.isEngineReady = true;
        console.log(`Agora RTC engine ready (appId: ${this.appId?.substring(0, 8)}...)`);
      } catch (e) {
        this.isEngineReady = false;
        console.warn('Agora RTC Native module not loaded. Voice calls require a dev client build (not Expo Go).', e?.message);
      }

      this.isLoggedIn = true;
      console.log(`Agora service initialized for user: ${this.userId}`);

      if (this.authToken) {
        this.connectSignaling(this.authToken);
      }
      if (!this.pollerInterval) {
        this.startPendingCallPoller();
      }
    } catch (err) {
      console.warn('Agora initialization error:', err);
    }
  }

  connectSignaling(token) {
    if (!token) return;
    this.authToken = token;

    try {
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return;
      }
      if (this.ws) {
        try { this.ws.close(); } catch (e) {}
      }

      const wsUrl = ENDPOINTS.wsSignaling(token);
      console.log('Connecting to user call signaling WebSocket:', wsUrl);
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('User call signaling WebSocket connected.');
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send('ping');
          }
        }, 15000);
      };

      this.ws.onmessage = (event) => {
        try {
          if (event.data === 'pong') return;
          const msg = JSON.parse(event.data);
          console.log('Signaling message received:', msg);

          if (msg.type === 'incoming_call') {
            useCallStore.getState().setIncomingCall({
              callId: msg.callId,
              channelName: msg.channelName,
              callerUserId: msg.callerUserId,
              callerName: msg.callerName || 'Incoming Caller',
            });
          } else if (msg.type === 'call_response') {
            const callId = String(msg.callId || '');
            const action = String(msg.action || '').toLowerCase();
            if (!this.shouldHandleCallAction(callId, action)) {
              console.log(`Ignoring duplicate/stale call response for ${callId}: ${action}`);
              return;
            }
            const respPayload = {
              callId,
              action,
              channelName: msg.channelName,
            };
            this.lastCallResponse = respPayload;
            this.emit('call_response', respPayload);
          } else if (msg.type === 'update_call_status_success') {
            this.pendingEndCallIds.delete(String(msg.call_id));
          }
        } catch (e) {
          console.warn('Error parsing signaling message:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('User signaling WebSocket closed. Reconnecting in 5s...');
        if (this.pingInterval) clearInterval(this.pingInterval);
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          if (this.authToken && this.isLoggedIn) {
            this.connectSignaling(this.authToken);
          }
        }, 5000);
      };

      this.ws.onerror = (err) => {
        console.warn('User signaling WebSocket error:', err.message);
      };
    } catch (e) {
      console.warn('Failed to establish user signaling WebSocket:', e);
    }
  }

  startPendingCallPoller() {
    if (this.pollerInterval) return;
    this.pollerInterval = setInterval(async () => {
      try {
        if (!this.isLoggedIn) return;

        const state = useCallStore.getState();
        if (state.incomingCall || state.status === 'active' || state.status === 'outgoing') return;

        const res = await api.getPendingCall();
        if (res.data?.has_pending) {
          const { callId, channelName, callerUserId, callerName } = res.data;
          if (callId && this.handledCallIds.has(String(callId))) {
            return;
          }
          console.log('Pending call detected via poller:', res.data);
          useCallStore.getState().setIncomingCall({
            callId,
            channelName,
            callerUserId,
            callerName: callerName || 'Incoming Caller',
          });
        }
      } catch (e) {
        // Silent poller catch
      }
    }, 4000);
  }

  on(event, callback) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(callback);
  }

  off(event, callback) {
    if (this.eventListeners[event]) {
      this.eventListeners[event] = this.eventListeners[event].filter((cb) => cb !== callback);
    }
  }

  emit(event, data) {
    if (this.eventListeners[event]) {
      this.eventListeners[event].forEach((cb) => cb(data));
    }
  }

  async sendCallInvitation(targetUserId, channelName, callId, callerName) {
    console.log(`Call invite dispatched via logCall for ${targetUserId}, channel ${channelName}`);
    return { status: 'sent', channelName, callId };
  }

  _normalizeStatus(action) {
    if (action === 'accept') return 'answered';
    if (action === 'decline') return 'declined';
    return action;
  }

  async respondToCallInvitation(callerUserId, action, channelName, callId) {
    console.log(`Responding to call invitation: ${action}`);
    if (callId) {
      this.markCallHandled(callId);
    }
    const normalizedStatus = this._normalizeStatus(action);

    if (this.ws && this.ws.readyState === WebSocket.OPEN && callId) {
      try {
        this.ws.send(JSON.stringify({
          type: 'update_call_status',
          payload: {
            call_id: callId,
            status: normalizedStatus,
            duration: 0,
          },
        }));
      } catch (e) {
        console.warn('Error sending WS update_call_status:', e);
      }
    }

    if (callId) {
      try {
        await api.updateCallStatus(callId, normalizedStatus);
      } catch (e) {
        console.warn('Error updating call status via HTTP API:', e);
      }
    }

    this.emit('call_response', {
      callerUserId,
      action: normalizedStatus,
      channelName,
      callId,
    });
  }

  _computeUid(userId = null) {
    let sourceId = userId || this.userId;
    if (!sourceId) {
      try {
        const { useAuthStore } = require('../../store/authStore');
        sourceId = useAuthStore.getState().user?.id;
      } catch (_) {}
    }
    const source = String(sourceId || 'truvoice-user').trim().toLowerCase();
    // Must match app.services.agora_service.generate_rtc_token exactly. Agora
    // rejects a token when the UID embedded in it differs from joinChannel's.
    let uid = 0;
    for (let i = 0; i < source.length; i += 1) {
      uid = (uid + (i + 1) * source.charCodeAt(i)) % 1000000000;
    }
    return uid + 1;
  }

  endCall(callId, duration = 0) {
    if (!callId) return;

    const normalizedCallId = String(callId);
    const payload = {
      call_id: normalizedCallId,
      status: 'ended',
      duration,
    };

    // WebSocket signaling reaches the other participant immediately. Do not
    // wait for an HTTP round trip before hanging up the local call.
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.pendingEndCallIds.add(normalizedCallId);
      try {
        this.ws.send(JSON.stringify({ type: 'update_call_status', payload }));
      } catch (e) {
        console.warn('Error sending immediate call-end signal:', e);
        this.pendingEndCallIds.delete(normalizedCallId);
        api.updateCallStatus(normalizedCallId, 'ended', duration)
          .catch((error) => console.warn('Call-end HTTP update failed:', error));
        return;
      }

      // Keep an HTTP fallback for a dropped signaling message. The server's
      // success acknowledgement cancels it, avoiding duplicate broadcasts.
      setTimeout(() => {
        if (!this.pendingEndCallIds.delete(normalizedCallId)) return;
        api.updateCallStatus(normalizedCallId, 'ended', duration)
          .catch((error) => console.warn('Call-end HTTP fallback failed:', error));
      }, 2000);
      return;
    }

    api.updateCallStatus(normalizedCallId, 'ended', duration)
      .catch((error) => console.warn('Call-end HTTP update failed:', error));
  }

  async joinChannel(channelName, token, uid) {
    if (!this.isEngineReady || !this.rtcEngine) {
      console.warn('Cannot join channel: Agora RTC engine not available. Rebuild with expo-dev-client.');
      return false;
    }
    if (!channelName || !token) {
      console.warn('Cannot join channel: missing channel name or token.');
      useCallStore.getState().setConnectionState('error');
      return false;
    }

    if (this.currentChannel === channelName) {
      console.log(`Agora: already joined channel ${channelName}; re-enabling audio and returning true.`);
      this._enableRemoteAudio();
      useCallStore.getState().setConnectionState('connected');
      return true;
    }

    useCallStore.getState().setConnectionState('connecting');

    try {
      await this.requestMicrophonePermission();

      const mediaOptions = {
        clientRoleType: 1,
        publishMicrophoneTrack: true,
        autoSubscribeAudio: true,
        enableAudioRecordingOrPlayout: true,
      };

      const resolvedUid = Number.isInteger(uid) && uid !== 0 ? uid : this._computeUid();
      const isRealToken = String(token || '').startsWith('007') || String(token || '').startsWith('006');
      console.log(
        `Agora: joining channel ${channelName} with uid ${resolvedUid} (appId: ${this.appId?.substring(0, 8)}...) ` +
        `token=${isRealToken ? 'REAL' : 'FAKE-dev-token — media will NOT work!'}`,
      );

      const joinResult = await this.rtcEngine.joinChannel(token, channelName, resolvedUid, mediaOptions);
      this._assertAgoraSuccess('joinChannel', joinResult);

      this.currentChannel = channelName;

      if (typeof this.rtcEngine.enableAudio === 'function') {
        this.rtcEngine.enableAudio();
      }
      if (typeof this.rtcEngine.enableLocalAudio === 'function') {
        this.rtcEngine.enableLocalAudio(true);
      }
      if (typeof this.rtcEngine.muteLocalAudioStream === 'function') {
        this.rtcEngine.muteLocalAudioStream(false);
      }
      if (typeof this.rtcEngine.muteAllRemoteAudioStreams === 'function') {
        this.rtcEngine.muteAllRemoteAudioStreams(false);
      }
      if (typeof this.rtcEngine.setEnableSpeakerphone === 'function') {
        this.rtcEngine.setEnableSpeakerphone(true);
      }
      if (typeof this.rtcEngine.setDefaultAudioRouteToSpeakerphone === 'function') {
        this.rtcEngine.setDefaultAudioRouteToSpeakerphone(true);
      }
      if (typeof this.rtcEngine.enableAudioVolumeIndication === 'function') {
        this.rtcEngine.enableAudioVolumeIndication(250, 3, true);
      }
      this._enableRemoteAudio();

      console.log(`Joined Agora RTC channel: ${channelName} using uid ${resolvedUid}`);
      return true;
    } catch (e) {
      console.warn('Error joining Agora RTC channel:', e);
      useCallStore.getState().setConnectionState('error');
      return false;
    }
  }

  async leaveChannel() {
    try {
      if (this.rtcEngine) {
        await this.rtcEngine.leaveChannel();
      }
      console.log(`Left Agora RTC channel: ${this.currentChannel}`);
    } catch (e) {
      console.warn('Error leaving Agora RTC channel:', e);
    } finally {
      this.currentChannel = null;
      this.remoteUsers.clear();
      // Do not leave a completed call marked active/outgoing: that disables
      // pending-call polling and prevents future calls from being received.
      useCallStore.getState().resetCall();
    }
  }

  async setMuted(isMuted) {
    try {
      if (this.rtcEngine) {
        this._assertAgoraSuccess(
          'muteLocalAudioStream',
          await this.rtcEngine.muteLocalAudioStream(Boolean(isMuted)),
        );
      }
    } catch (e) {
      console.warn('Error setting mute state:', e);
    }
  }

  async setSpeaker(isSpeakerOn) {
    try {
      if (this.rtcEngine) {
        if (typeof this.rtcEngine.setEnableSpeakerphone === 'function') {
          await this.rtcEngine.setEnableSpeakerphone(isSpeakerOn);
        }
        if (typeof this.rtcEngine.setDefaultAudioRouteToSpeakerphone === 'function') {
          await this.rtcEngine.setDefaultAudioRouteToSpeakerphone(isSpeakerOn);
        }
      }
    } catch (e) {
      console.warn('Error setting speaker state:', e);
    }
  }

  getEngine() {
    return this.rtcEngine;
  }

  isRtcAvailable() {
    return this.isEngineReady && !!this.rtcEngine;
  }

  getMediaEngine() {
    if (this.rtcEngine && typeof this.rtcEngine.getMediaEngine === 'function') {
      try {
        return this.rtcEngine.getMediaEngine();
      } catch (e) {
        console.warn('Failed to get MediaEngine:', e);
      }
    }
    return null;
  }

  registerAudioFrameObserver(observer) {
    try {
      const mediaEngine = this.getMediaEngine();
      if (mediaEngine && typeof mediaEngine.registerAudioFrameObserver === 'function') {
        return mediaEngine.registerAudioFrameObserver(observer);
      }
    } catch (e) {
      console.warn('Error registering audio frame observer on Agora MediaEngine:', e);
    }
    return null;
  }

  configurePlaybackAudioFrames(sampleRate = 16000, channels = 1, samplesPerCall = 1024) {
    try {
      if (this.rtcEngine && typeof this.rtcEngine.setPlaybackAudioFrameParameters === 'function') {
        // RawAudioFrameOpModeReadOnly. Explicit configuration is required by
        // Agora before it dispatches onPlaybackAudioFrame callbacks.
        return this.rtcEngine.setPlaybackAudioFrameParameters(
          sampleRate,
          channels,
          0,
          samplesPerCall,
        );
      }
    } catch (e) {
      console.warn('Error configuring Agora playback audio frames:', e);
    }
    return null;
  }

  unregisterAudioFrameObserver(observer) {
    try {
      const mediaEngine = this.getMediaEngine();
      if (mediaEngine && typeof mediaEngine.unregisterAudioFrameObserver === 'function') {
        return mediaEngine.unregisterAudioFrameObserver(observer);
      }
    } catch (e) {
      console.warn('Error unregistering audio frame observer on Agora MediaEngine:', e);
    }
    return null;
  }

  cleanup() {
    if (this.pollerInterval) clearInterval(this.pollerInterval);
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }
  }
}

export const agoraService = new AgoraService();
export default agoraService;
