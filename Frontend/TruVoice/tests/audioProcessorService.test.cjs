const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const babel = require('@babel/core');
const transformModules = require('@babel/plugin-transform-modules-commonjs');

const serviceFile = path.resolve(__dirname, '../src/services/audio/audioProcessorService.js');
const source = babel.transformSync(fs.readFileSync(serviceFile, 'utf8'), {
  filename: serviceFile,
  babelrc: false,
  configFile: false,
  plugins: [transformModules],
}).code;

function createProcessor(analyzeAudioBase64) {
  const loadedModule = new Module(serviceFile, module);
  loadedModule.filename = serviceFile;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(serviceFile));
  loadedModule.require = (moduleName) => {
    if (moduleName === '../agora/agoraService') {
      return {
        agoraService: {
          configurePlaybackAudioFrames() {},
          registerAudioFrameObserver() {},
          unregisterAudioFrameObserver() {},
        },
      };
    }
    if (moduleName === '../api/client') {
      return { api: { analyzeAudioBase64 } };
    }
    if (moduleName === '../../constants/config') {
      return { default: { audioChunkIntervalMs: 5000 } };
    }
    return require(moduleName);
  };
  loadedModule._compile(source, serviceFile);
  return loadedModule.exports;
}

function createPcmFrame(sampleValue) {
  const frame = new Uint8Array(640);
  const view = new DataView(frame.buffer);
  for (let offset = 0; offset < frame.byteLength; offset += 2) {
    view.setInt16(offset, sampleValue, true);
  }
  return frame;
}

const submitFrames = (processor, frame, count) => {
  for (let index = 0; index < count; index += 1) {
    processor._handleAudioFrame({
      buffer: frame,
      samplesPerSec: 16000,
      channels: 1,
    });
  }
};

test('waits for caller audio, then sends 5-second audio windows and shows analysis status', async () => {
  const requests = [];
  const results = [];
  const statuses = [];
  const { audioProcessorService, hasVoiceActivity } = createProcessor(async (encoded) => {
    requests.push(Buffer.from(encoded, 'base64'));
    return { data: { ai_voice_probability: 12 } };
  });

  assert.equal(hasVoiceActivity(createPcmFrame(0)), false);
  assert.equal(hasVoiceActivity(createPcmFrame(80)), false);
  assert.equal(hasVoiceActivity(createPcmFrame(100)), true);

  await audioProcessorService.start(
    'test-call',
    'caller',
    (result) => results.push(result),
    5000,
    (status) => statuses.push(status),
  );

  submitFrames(audioProcessorService, createPcmFrame(0), 25);
  assert.equal(requests.length, 0, 'silence must not start analysis');

  const voicedFrame = createPcmFrame(2000);
  submitFrames(audioProcessorService, voicedFrame, 249);
  assert.equal(requests.length, 0, 'analysis must wait for a full five-second window');

  submitFrames(audioProcessorService, voicedFrame, 1);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requests.length, 1);
  assert.equal(requests[0].readUInt32LE(40), 16000 * 5 * 2);
  assert.deepEqual(results, [{ ai_voice_probability: 12 }]);

  submitFrames(audioProcessorService, voicedFrame, 250);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 2, 'subsequent 5-second windows must also be analyzed');
  assert.equal(requests[1].readUInt32LE(40), 16000 * 5 * 2);
  assert.deepEqual(results, [
    { ai_voice_probability: 12 },
    { ai_voice_probability: 12 },
  ]);
  assert.deepEqual(statuses, [
    'listening',
    'analyzing',
    'listening',
    'analyzing',
    'listening',
  ]);
  audioProcessorService.stop();
});

test('fires the demo threshold only after seven seconds of detected voice activity', async () => {
  let thresholdCount = 0;
  const { audioProcessorService } = createProcessor(async () => ({ data: null }));

  await audioProcessorService.start(
    'test-call',
    'caller',
    () => {},
    10000,
    null,
    () => {
      thresholdCount += 1;
    },
  );

  const silenceFrame = createPcmFrame(0);
  const voiceFrame = createPcmFrame(2000);
  submitFrames(audioProcessorService, silenceFrame, 400);
  assert.equal(thresholdCount, 0, 'silence must not start the demo threshold');

  submitFrames(audioProcessorService, voiceFrame, 349);
  assert.equal(thresholdCount, 0, 'the threshold must wait for seven seconds of voice');

  submitFrames(audioProcessorService, voiceFrame, 1);
  assert.equal(thresholdCount, 1);
  submitFrames(audioProcessorService, voiceFrame, 10);
  assert.equal(thresholdCount, 1, 'the threshold should fire once per audio window');

  audioProcessorService.setMuted(true);
  audioProcessorService.setMuted(false);
  submitFrames(audioProcessorService, voiceFrame, 349);
  assert.equal(thresholdCount, 1, 'muting resets the detected-voice duration');
  submitFrames(audioProcessorService, voiceFrame, 1);
  assert.equal(thresholdCount, 2);

  audioProcessorService.stop();
});

test('does not publish a late result after the call processor stops', async () => {
  let resolveAnalysis;
  const results = [];
  const { audioProcessorService } = createProcessor(
    () => new Promise((resolve) => {
      resolveAnalysis = resolve;
    }),
  );

  await audioProcessorService.start('test-call', 'caller', (result) => results.push(result), 5000);
  submitFrames(audioProcessorService, createPcmFrame(2000), 250);
  assert.equal(typeof resolveAnalysis, 'function');

  audioProcessorService.stop();
  resolveAnalysis({ data: { ai_voice_probability: 99 } });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(results, []);
});
