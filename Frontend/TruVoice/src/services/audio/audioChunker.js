import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';

export async function deleteAudioFile(uri) {
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // ignore cleanup errors
  }
}

class AudioChunkerService {
  constructor() {
    this.recording = null;
    this.chunkTimer = null;
    this.isChunking = false;
    this.isMuted = false;
    this.isAnalysisStopped = false;
    this.chunkIndex = 0;
    this.onChunkCallback = null;
    this.intervalMs = 20000;
  }

  async requestPermissions() {
    try {
      const response = await Audio.requestPermissionsAsync();
      return response.granted;
    } catch (error) {
      console.warn('Audio permission error:', error);
      return false;
    }
  }

  async setMuted(muted) {
    const wasMuted = this.isMuted;
    this.isMuted = !!muted;
    if (!this.isChunking) return;

    if (this.isMuted && !wasMuted) {
      if (this.recording) {
        try {
          const rec = this.recording;
          this.recording = null;
          await rec.stopAndUnloadAsync();
          await deleteAudioFile(rec.getURI());
        } catch {
          // silent
        }
      }
    } else if (!this.isMuted && wasMuted && !this.isAnalysisStopped) {
      await this._startRecordingChunk();
    }
  }

  async setAnalysisStopped(stopped) {
    this.isAnalysisStopped = !!stopped;
    if (this.isAnalysisStopped && this.recording) {
      try {
        const rec = this.recording;
        this.recording = null;
        await rec.stopAndUnloadAsync();
        await deleteAudioFile(rec.getURI());
      } catch {
        // silent
      }
    } else if (!this.isAnalysisStopped && !this.isMuted) {
      await this._startRecordingChunk();
    }
  }

  async startChunking(onChunkCallback, intervalMs = 20000) {
    console.warn('Legacy audioChunker startChunking called. Hardware mic recording disabled in favor of Agora audioProcessorService.');
    this.isChunking = false;
    return false;
  }

  async _startRecordingChunk() {
    // Hardware mic recording is disabled — audio frames are captured via the
    // Agora frame observer in audioProcessorService instead. Keeping this
    // method as a no-op so existing call-sites don't crash.
    this.recording = null;
    return;
  }


  _scheduleNextCycle() {
    if (!this.isChunking) return;

    this.chunkTimer = setTimeout(async () => {
      if (!this.isChunking) return;

      const currentRecording = this.recording;
      this.recording = null;

      if (this.isMuted || this.isAnalysisStopped) {
        this.onChunkCallback?.({
          chunkIndex: this.chunkIndex,
          mp3Uri: null,
          isMuted: this.isMuted,
          isAnalysisStopped: this.isAnalysisStopped,
          timestamp: new Date().toISOString(),
          durationMs: this.intervalMs,
        });
        this.chunkIndex += 1;

        if (currentRecording) {
          try {
            await currentRecording.stopAndUnloadAsync();
            await deleteAudioFile(currentRecording.getURI());
          } catch {
            // silent
          }
        }

        this._scheduleNextCycle();
        return;
      }

      if (currentRecording) {
        await this._processAndEmitChunk(currentRecording, this.chunkIndex);
        this.chunkIndex += 1;
      }

      if (this.isChunking) {
        await this._startRecordingChunk();
        this._scheduleNextCycle();
      }
    }, this.intervalMs);
  }

  async _processAndEmitChunk(recordingInstance, index) {
    let sourceUri = null;

    try {
      const status = await recordingInstance.getStatusAsync();
      if (status.canRecord && status.isRecording) {
        await recordingInstance.stopAndUnloadAsync();
      }

      sourceUri = recordingInstance.getURI();
      if (!sourceUri) return;

      this.onChunkCallback?.({
        chunkIndex: index,
        mp3Uri: sourceUri,
        audioUri: sourceUri,
        mimeType: 'audio/m4a',
        fileName: `truvoice_chunk_${index}.m4a`,
        isMuted: false,
        isAnalysisStopped: false,
        timestamp: new Date().toISOString(),
        durationMs: this.intervalMs,
      });
    } catch (error) {
      console.error(`Error processing audio chunk #${index}:`, error);
      this.onChunkCallback?.({
        chunkIndex: index,
        error: error.message,
        mp3Uri: null,
      });
    }
  }

  async stopChunking() {
    this.isChunking = false;

    if (this.chunkTimer) {
      clearTimeout(this.chunkTimer);
      this.chunkTimer = null;
    }

    if (this.recording) {
      try {
        const rec = this.recording;
        this.recording = null;
        const status = await rec.getStatusAsync();
        if (status.canRecord && status.isRecording) {
          await rec.stopAndUnloadAsync();
        }
        await deleteAudioFile(rec.getURI());
      } catch {
        // silent
      }
    }

    // No-op for Audio.setAudioModeAsync to avoid resetting or interfering with Agora audio session
  }
}

export const audioChunker = new AudioChunkerService();
export default audioChunker;
