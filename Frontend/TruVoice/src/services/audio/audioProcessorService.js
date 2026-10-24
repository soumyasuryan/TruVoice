import { agoraService } from '../agora/agoraService';
import { api } from '../api/client';


function uint8ToBase64(uint8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let base64 = '';
  const len = uint8.byteLength;
  for (let i = 0; i < len; i += 3) {
    const b1 = uint8[i];
    const b2 = i + 1 < len ? uint8[i + 1] : 0;
    const b3 = i + 2 < len ? uint8[i + 2] : 0;

    const c1 = b1 >> 2;
    const c2 = ((b1 & 3) << 4) | (b2 >> 4);
    const c3 = ((b2 & 15) << 2) | (b3 >> 6);
    const c4 = b3 & 63;

    base64 += chars[c1] + chars[c2];
    base64 += i + 1 < len ? chars[c3] : '=';
    base64 += i + 2 < len ? chars[c4] : '=';
  }
  return base64;
}

function createWavHeader(dataLength, sampleRate = 16000, numChannels = 1, bitsPerSample = 16) {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);

  // "RIFF"
  header.set([82, 73, 70, 70], 0);
  // SubchunkSize = 36 + dataLength
  view.setUint32(4, 36 + dataLength, true);
  // "WAVE"
  header.set([87, 65, 86, 69], 8);
  // "fmt "
  header.set([102, 109, 116, 32], 12);
  // Subchunk1Size = 16 for PCM
  view.setUint32(16, 16, true);
  // AudioFormat = 1 (PCM)
  view.setUint16(20, 1, true);
  // NumChannels
  view.setUint16(22, numChannels, true);
  // SampleRate
  view.setUint32(24, sampleRate, true);
  // ByteRate = SampleRate * NumChannels * BitsPerSample / 8
  view.setUint32(28, (sampleRate * numChannels * bitsPerSample) / 8, true);
  // BlockAlign = NumChannels * BitsPerSample / 8
  view.setUint16(32, (numChannels * bitsPerSample) / 8, true);
  // BitsPerSample
  view.setUint16(34, bitsPerSample, true);
  // "data"
  header.set([100, 97, 116, 97], 36);
  // Subchunk2Size
  view.setUint32(40, dataLength, true);

  return header;
}

class AudioProcessorService {
  constructor() {
    this.isProcessing = false;
    this.isMuted = false;
    this.isStopped = false;
    this.callId = null;
    this.callerNumber = null;
    this.onAnalysisCallback = null;
    this.intervalTimer = null;
    this.pcmChunks = [];
    this.frameObserver = null;
    this.intervalMs = 20000;
    this.sampleRate = 16000;
    this.numChannels = 1;
  }

  async start(callId, callerNumber, onAnalysisCallback, intervalMs = 20000) {
    if (this.isProcessing) {
      this.stop();
    }

    this.callId = callId;
    this.callerNumber = callerNumber;
    this.onAnalysisCallback = onAnalysisCallback;
    this.intervalMs = intervalMs;
    this.isProcessing = true;
    this.isMuted = false;
    this.isStopped = false;
    this.pcmChunks = [];

    console.log(`Starting AudioProcessorService for call ${callId}, caller ${callerNumber}`);

    // Analyze only the audio rendered by Agora. Record frames are this device's
    // microphone and mixed frames include it, which analyzes the wrong person.
    this.frameObserver = {
      onPlaybackAudioFrame: (channelId, audioFrame) => {
        if (!this.isProcessing || this.isMuted || this.isStopped) return;
        this._handleAudioFrame(audioFrame);
      },
    };

    agoraService.configurePlaybackAudioFrames(this.sampleRate, this.numChannels);
    agoraService.registerAudioFrameObserver(this.frameObserver);

    // Schedule 20-second chunk processing timer
    this.intervalTimer = setInterval(async () => {
      if (!this.isProcessing || this.isMuted || this.isStopped) return;
      await this._flushAndAnalyzeBuffer();
    }, this.intervalMs);

    return true;
  }

  _handleAudioFrame(audioFrame) {
    if (!audioFrame) return;

    if (audioFrame.samplesPerSec) {
      this.sampleRate = audioFrame.samplesPerSec;
    }
    if (audioFrame.channels) {
      this.numChannels = audioFrame.channels;
    }

    let frameBytes = null;
    if (audioFrame.buffer instanceof Uint8Array) {
      frameBytes = audioFrame.buffer;
    } else if (audioFrame.buffer instanceof ArrayBuffer) {
      frameBytes = new Uint8Array(audioFrame.buffer);
    } else if (typeof audioFrame.buffer === 'string') {
      const str = audioFrame.buffer;
      frameBytes = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) {
        frameBytes[i] = str.charCodeAt(i) & 0xff;
      }
    }

    if (frameBytes && frameBytes.length > 0) {
      this.pcmChunks.push(frameBytes);
    }
  }

  async _flushAndAnalyzeBuffer() {
    if (!this.isProcessing || this.isMuted || this.isStopped) return;

    let totalLength = this.pcmChunks.reduce((acc, chunk) => acc + chunk.length, 0);

    // Do not submit fabricated silence. It creates empty transcripts and can
    // make the UI look like the GPU speech-to-text service has failed.
    if (totalLength === 0) {
      console.warn('Skipping analysis: Agora provided no remote playback audio frames.');
      return;
    }

    // Combine PCM chunks into single Uint8Array
    const pcmData = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of this.pcmChunks) {
      pcmData.set(chunk, offset);
      offset += chunk.length;
    }
    this.pcmChunks = []; // reset for next 20s window

    // Prepend 44-byte WAV header
    const wavHeader = createWavHeader(pcmData.length, this.sampleRate, this.numChannels, 16);
    const wavFileBytes = new Uint8Array(wavHeader.length + pcmData.length);
    wavFileBytes.set(wavHeader, 0);
    wavFileBytes.set(pcmData, wavHeader.length);

    // Convert complete WAV buffer to Base64
    const base64Wav = uint8ToBase64(wavFileBytes);

    try {
      console.log(`Sending ${base64Wav.length} Base64 WAV chars to /api/v1/analysis/audio`);
      const response = await api.analyzeAudioBase64(base64Wav, this.callerNumber, this.callId);
      if (response.data && typeof this.onAnalysisCallback === 'function') {
        this.onAnalysisCallback(response.data);
      }
    } catch (err) {
      console.warn('AudioProcessorService analysis submission error:', err);
    }
  }

  setMuted(muted) {
    this.isMuted = !!muted;
    if (this.isMuted) {
      this.pcmChunks = [];
    }
  }

  setStopped(stopped) {
    this.isStopped = !!stopped;
    if (this.isStopped) {
      this.pcmChunks = [];
    }
  }

  stop() {
    this.isProcessing = false;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.frameObserver) {
      agoraService.unregisterAudioFrameObserver(this.frameObserver);
      this.frameObserver = null;
    }
    this.pcmChunks = [];
    console.log('AudioProcessorService stopped.');
  }
}

export const audioProcessorService = new AudioProcessorService();
export default audioProcessorService;
