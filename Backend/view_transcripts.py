"""
Quick transcription viewer for all audio files in test_voice/ folder.
Run: python view_transcripts.py
"""
import argparse
import sys
import time
from pathlib import Path

root_dir = Path(__file__).resolve().parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from app.services.local_stt import LocalSTTSanitizer
from app.config import settings

SUPPORTED_EXTENSIONS = {".wav", ".mp3",".mp4", ".m4a", ".flac", ".ogg", ".opus", ".mpeg", ".webm"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Print sanitized local Whisper transcripts and timings.")
    parser.add_argument("path", nargs="?", default="test_voice", help="Audio file or directory (default: test_voice)")
    parser.add_argument(
        "--model",
        default=settings.STT_MODEL_SIZE,
        help="faster-whisper model name or local model path",
    )
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    parser.add_argument("--strict-gpu", action="store_true", help="Fail instead of falling back to CPU")
    return parser.parse_args()


def find_audio_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path] if path.suffix.lower() in SUPPORTED_EXTENSIONS else []
    if path.is_dir():
        return sorted(file for file in path.iterdir() if file.is_file() and file.suffix.lower() in SUPPORTED_EXTENSIONS)
    return []


def main() -> int:
    args = parse_args()
    audio_files = find_audio_files(Path(args.path))

    if not audio_files:
        print(f"No supported audio files found at: {args.path}")
        return 2

    print("\n" + "=" * 100)
    print("  TRUVOICE — LOCAL CUDA STT TRANSCRIPT VIEWER")
    print("=" * 100)
    print(f"  Files found: {len(audio_files)}")
    print("=" * 100)

    load_start = time.perf_counter()
    stt = LocalSTTSanitizer(
        model_size=args.model,
        device=args.device,
        allow_cpu_fallback=not args.strict_gpu,
    )
    print(f"Model ready in {time.perf_counter() - load_start:.2f}s | device: {stt.device} | model: {args.model}\n")

    for i, file_path in enumerate(sorted(audio_files), 1):
        print(f"[{i}/{len(audio_files)}] Processing: {file_path.name}")
        print("-" * 100)

        result = stt.process_audio(str(file_path))

        print(f"  Device:              {result['device']}")
        print(f"  Whisper GPU/CPU:     {result['transcription_latency_sec']:.3f}s")
        print(f"  Presidio redaction:  {result['sanitization_latency_sec']:.3f}s")
        print(f"  Total:               {result['stt_latency_sec']:.3f}s")
        print(f"  Raw transcript:      {result['raw_transcript'] or '[EMPTY / SILENT]'}")
        print(f"  Sanitized transcript:{result['sanitized_transcript'] or '[EMPTY / SILENT]'}")
        print()

    print("=" * 100)
    print("  Done.")
    print("=" * 100 + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
