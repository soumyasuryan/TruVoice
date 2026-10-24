import { agoraService } from '../agora/agoraService';
import { api } from '../api/client';
import config from '../../constants/config';

const SPEECH_ACTIVITY_RMS_THRESHOLD = 0.003;

export const hasVoiceActivity = (frameBytes, channels = 1) => {
  const sampleCount = Math.floor(frameBytes.byteLength / 2);
  if (!sampleCount) return false;

  const view = new DataView(
    frameBytes.buffer,
    frameBytes.byteOffset,
    frameBytes.byteLength,
  );
  let sumSquares = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = view.getInt16(index * 2, true);
    sumSquares += sample * sample;
  }

  const rms = Math.sqrt(sumSquares / sampleCount) / 32768;
  return rms >= SPEECH_ACTIVITY_RMS_THRESHOLD && channels > 0;
};


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
    this.intervalMs = config.audioChunkIntervalMs;
    this.audioWindowDurationMs = 0;
    this.hasDetectedCallerAudio = false;
    this.detectedVoiceDurationMs = 0;
    this.hasReachedVoiceDetectionThreshold = false;
    this.pendingAnalysisCount = 0;
    this.analysisGeneration = 0;
    this.onStatusChange = null;
    this.onVoiceDetectionThreshold = null;
    this.sampleRate = 16000;
    this.numChannels = 1;
  }

  async start(
    callId,
    callerNumber,
    onAnalysisCallback,
    intervalMs = config.audioChunkIntervalMs,
    onStatusChange = null,
    onVoiceDetectionThreshold = null,
  ) {
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
    this.audioWindowDurationMs = 0;
    this.hasDetectedCallerAudio = false;
    this.detectedVoiceDurationMs = 0;
    this.hasReachedVoiceDetectionThreshold = false;
    this.pendingAnalysisCount = 0;
    this.analysisGeneration += 1;
    this.onStatusChange = onStatusChange;
    this.onVoiceDetectionThreshold = onVoiceDetectionThreshold;
    this.onStatusChange?.('listening');

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
      const frameDurationMs =
        (frameBytes.length / (2 * this.numChannels * this.sampleRate)) * 1000;
      const hasVoice = hasVoiceActivity(frameBytes, this.numChannels);
      if (!this.hasDetectedCallerAudio && !hasVoice) {
        return;
      }

      this.hasDetectedCallerAudio = true;
      if (hasVoice) {
        this.detectedVoiceDurationMs += frameDurationMs;
        if (
          !this.hasReachedVoiceDetectionThreshold &&
          this.detectedVoiceDurationMs >= 7000
        ) {
          this.hasReachedVoiceDetectionThreshold = true;
          this.onVoiceDetectionThreshold?.();
        }
      }
      this.pcmChunks.push(frameBytes);
      this.audioWindowDurationMs += frameDurationMs;

      if (this.audioWindowDurationMs >= this.intervalMs) {
        this._flushAndAnalyzeBuffer().catch((error) => {
          console.error('AudioProcessorService failed to process an audio window:', error);
        });
      }
    }
  }

  async _flushAndAnalyzeBuffer() {
    if (!this.isProcessing || this.isMuted || this.isStopped) return;

    let totalLength = this.pcmChunks.reduce((acc, chunk) => acc + chunk.length, 0);

    // Do not submit fabricated silence. It creates empty transcripts and can
    // make the UI look like the GPU speech-to-text service has failed.
    if (totalLength === 0) {
      return false;
    }

    // Combine PCM chunks into single Uint8Array
    const pcmData = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of this.pcmChunks) {
      pcmData.set(chunk, offset);
      offset += chunk.length;
    }
    this.pcmChunks = []; // reset for the next analysis window
    this.audioWindowDurationMs = 0;

    // Prepend 44-byte WAV header
    const wavHeader = createWavHeader(pcmData.length, this.sampleRate, this.numChannels, 16);
    const wavFileBytes = new Uint8Array(wavHeader.length + pcmData.length);
    wavFileBytes.set(wavHeader, 0);
    wavFileBytes.set(pcmData, wavHeader.length);

    // Convert complete WAV buffer to Base64
    const base64Wav = uint8ToBase64(wavFileBytes);

    const generation = this.analysisGeneration;
    this.pendingAnalysisCount += 1;
    this.onStatusChange?.('analyzing');
    try {
      console.log(`Sending ${base64Wav.length} Base64 WAV chars to /api/v1/analysis/audio`);
      const response = await api.analyzeAudioBase64(base64Wav, this.callerNumber, this.callId);
      if (
        generation === this.analysisGeneration &&
        response.data &&
        typeof this.onAnalysisCallback === 'function'
      ) {
        this.onAnalysisCallback(response.data);
      }
      return Boolean(response.data);
    } catch (err) {
      console.warn('AudioProcessorService analysis submission error:', err);
      return false;
    } finally {
      if (generation === this.analysisGeneration) {
        this.pendingAnalysisCount -= 1;
        this.onStatusChange?.(
          this.isMuted || this.isStopped
            ? 'paused'
            : this.pendingAnalysisCount > 0
              ? 'analyzing'
              : 'listening',
        );
      }
    }
  }

  setMuted(muted) {
    this.isMuted = !!muted;
    this._resetAudioWindow();
  }

  setStopped(stopped) {
    this.isStopped = !!stopped;
    this._resetAudioWindow();
  }

  _resetAudioWindow() {
    this.pcmChunks = [];
    this.audioWindowDurationMs = 0;
    this.hasDetectedCallerAudio = false;
    this.detectedVoiceDurationMs = 0;
    this.hasReachedVoiceDetectionThreshold = false;
    this.onStatusChange?.(this.isMuted || this.isStopped ? 'paused' : 'listening');
  }

  stop() {
    this.isProcessing = false;
    this.analysisGeneration += 1;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.frameObserver) {
      agoraService.unregisterAudioFrameObserver(this.frameObserver);
      this.frameObserver = null;
    }
    this.pcmChunks = [];
    this.audioWindowDurationMs = 0;
    this.hasDetectedCallerAudio = false;
    this.detectedVoiceDurationMs = 0;
    this.hasReachedVoiceDetectionThreshold = false;
    this.pendingAnalysisCount = 0;
    this.onStatusChange = null;
    this.onVoiceDetectionThreshold = null;
    console.log('AudioProcessorService stopped.');
  }
}

export const audioProcessorService = new AudioProcessorService();
export default audioProcessorService;
