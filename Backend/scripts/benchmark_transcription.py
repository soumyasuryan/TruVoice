"""Compare current English/no-VAD decode settings with multilingual VAD decode.

Place a reference .txt beside each audio file in the supplied directory.
Both passes use the local large-v3 model; no external transcription API is used.
"""

import argparse
import re
import statistics
import sys
import time
from pathlib import Path

from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio
import torch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import settings
from app.services.transcription_core import (
    get_hinglish_asr_prompt,
    normalize_and_detect_language,
)

AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg"}


def words(text: str) -> list[str]:
    return re.findall(r"\w+", text.casefold())


def word_error_rate(reference: str, hypothesis: str) -> float:
    reference_words = words(reference)
    hypothesis_words = words(hypothesis)
    if not reference_words:
        return 0.0 if not hypothesis_words else 1.0

    previous = list(range(len(hypothesis_words) + 1))
    for row, reference_word in enumerate(reference_words, start=1):
        current = [row]
        for column, hypothesis_word in enumerate(hypothesis_words, start=1):
            current.append(min(
                current[column - 1] + 1,
                previous[column] + 1,
                previous[column - 1] + (reference_word != hypothesis_word),
            ))
        previous = current
    return previous[-1] / len(reference_words)


def transcribe(
    model,
    audio,
    *,
    language: str | None,
    vad_filter: bool,
    multilingual: bool,
) -> str:
    segments, _ = model.transcribe(
        audio,
        beam_size=settings.STT_BEAM_SIZE,
        language=language,
        multilingual=multilingual,
        condition_on_previous_text=True,
        initial_prompt=get_hinglish_asr_prompt() if multilingual else None,
        vad_filter=vad_filter,
        vad_parameters={"min_silence_duration_ms": settings.STT_MIN_SILENCE_DURATION_MS},
    )
    return " ".join(segment.text.strip() for segment in segments).strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio_dir", type=Path, help="Directory of audio files and matching .txt references")
    parser.add_argument("--model", default="large-v3", help="Local faster-whisper model name/path")
    args = parser.parse_args()
    if "turbo" in args.model.casefold():
        parser.error("The benchmark must use large-v3, not a Whisper turbo model.")

    files = sorted(
        path for path in args.audio_dir.rglob("*")
        if path.is_file() and path.suffix.casefold() in AUDIO_EXTENSIONS
    )
    if not files:
        parser.error(f"No supported audio files found in {args.audio_dir}")
    missing_references = [path for path in files if not path.with_suffix(".txt").is_file()]
    if missing_references:
        parser.error(
            "Missing matching reference files: "
            + ", ".join(str(path.with_suffix(".txt")) for path in missing_references)
        )

    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = settings.STT_COMPUTE_TYPE if device == "cuda" else "int8"
    model = WhisperModel(
        args.model,
        device=device,
        compute_type=compute_type,
    )
    baseline_errors = []
    candidate_errors = []
    baseline_latencies = []
    candidate_latencies = []

    warmup_audio = decode_audio(str(files[0]), sampling_rate=16_000)
    transcribe(
        model,
        warmup_audio,
        language="en",
        vad_filter=False,
        multilingual=False,
    )
    transcribe(
        model,
        warmup_audio,
        language=None,
        vad_filter=True,
        multilingual=True,
    )

    for audio_path in files:
        audio = decode_audio(str(audio_path), sampling_rate=16_000)
        reference = audio_path.with_suffix(".txt").read_text(encoding="utf-8")

        start = time.perf_counter()
        baseline = transcribe(
            model,
            audio,
            language="en",
            vad_filter=False,
            multilingual=False,
        )
        baseline_latency = time.perf_counter() - start
        baseline_wer = word_error_rate(reference, baseline)

        start = time.perf_counter()
        candidate = transcribe(
            model,
            audio,
            language=None,
            vad_filter=True,
            multilingual=True,
        )
        candidate, candidate_language, _language_confidence = (
            normalize_and_detect_language(candidate)
        )
        candidate_latency = time.perf_counter() - start
        candidate_wer = word_error_rate(reference, candidate)

        baseline_errors.append(baseline_wer)
        candidate_errors.append(candidate_wer)
        baseline_latencies.append(baseline_latency)
        candidate_latencies.append(candidate_latency)
        print(
            f"{audio_path.name}: "
            f"English/no-VAD WER={baseline_wer:.3f}, {baseline_latency:.3f}s; "
            f"auto-language/VAD/{candidate_language} WER={candidate_wer:.3f}, "
            f"{candidate_latency:.3f}s\n"
            f"  reference: {reference.strip()}\n"
            f"  baseline:  {baseline}\n"
            f"  candidate: {candidate}"
        )

    print(
        "MEAN: "
        f"English/no-VAD WER={statistics.mean(baseline_errors):.3f}, "
        f"{statistics.mean(baseline_latencies):.3f}s; "
        f"auto-language/VAD WER={statistics.mean(candidate_errors):.3f}, "
        f"{statistics.mean(candidate_latencies):.3f}s"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
