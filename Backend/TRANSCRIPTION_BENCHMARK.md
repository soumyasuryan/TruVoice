# Transcription pipeline benchmark status

## Changes covered by deterministic tests

The live backend now uses the configured local `large-v3` Whisper model and
emits the first normalized, PII-sanitized segment while the decoder is still
producing the rest of the chunk. It emits a separate final stitched transcript
after chunk-boundary deduplication. The score path receives the recognizer's
confidence as context and does not wait for a confidence threshold.

Regression cases cover English speech, Devanagari Hindi, mixed Hinglish,
silence gating, fast multi-segment speech, bank claims, OTP/KYC normalization,
partial/final event separation, and confidence propagation to downstream
scoring. The text-only scam-intent client no longer contains a remote Whisper
transcription route; audio transcription remains in the local faster-whisper
service.

The deterministic text checks verify exact expected output. They are not
recorded-audio WER measurements and cannot establish an acoustic accuracy
improvement over another checkpoint.

## Local audio benchmark

Run `python scripts/benchmark_transcription.py <audio-dir> --model large-v3`
from `Backend`. Each audio file must have a same-name `.txt` reference beside
it. The script compares the previous English/no-VAD decode configuration with
the current auto-language/VAD decode and normalization path, reporting WER,
latency, and the reference/baseline/candidate text for each case.

A large-v3 checkpoint is present in the local Hugging Face cache, but no
representative audio/reference corpus was available for a model-level
comparison. Therefore:

- No acoustic WER or latency improvement is claimed.
- The cached checkpoint was not exercised against a real speech corpus here.
- No comparison against a turbo checkpoint was run or used as the baseline.
- Acceptance of a noticeable English acoustic-quality gain remains pending
  execution on a consented, representative English/Hinglish corpus.

## Runtime instrumentation

Backend logs report `time_to_first_partial_sec`,
`time_to_final_stitched_sec`, transcript word count and confidence, plus
`time_to_first_score_sec`. The score timer runs from analysis-pipeline entry
through completion of the text-intent score; the first-partial and final
transcript timers start at audio preprocessing for that audio chunk.
