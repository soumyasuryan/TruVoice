import { io } from 'socket.io-client';
import { config, WS_CHANNELS } from '../../constants/config';

class SocketService {
  constructor() {
    this.sockets = {};
  }

  connect(channel, options = {}) {
    if (this.sockets[channel]?.connected) {
      return this.sockets[channel];
    }

    const url = `${config.wsBaseUrl}${channel}`;
    const socket = io(url, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      ...options,
    });

    this.sockets[channel] = socket;
    return socket;
  }

  disconnect(channel) {
    const socket = this.sockets[channel];
    if (socket) {
      socket.disconnect();
      delete this.sockets[channel];
    }
  }

  disconnectAll() {
    Object.keys(this.sockets).forEach((channel) => this.disconnect(channel));
  }

  getCallSocket(options) {
    return this.connect(WS_CHANNELS.call, options);
  }

  getVoiceAnalysisSocket(options) {
    return this.connect(WS_CHANNELS.voiceAnalysis, options);
  }
}

export const socketService = new SocketService();
export default socketService;
