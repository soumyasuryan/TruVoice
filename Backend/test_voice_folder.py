import argparse
import os
import sys
import time
from pathlib import Path

# Ensure project root is in sys.path
root_dir = Path(__file__).resolve().parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

import joblib
import librosa
import numpy as np

from app.config import settings
from app.utils.pipeline import get_pipeline, UnifiedPipelineTester

SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".flac", ".m4a", ".ogg", ".mpeg", ".aac", ".opus"}


def extract_legacy_features(audio_array: np.ndarray, sr: int = 16000) -> np.ndarray:
    """Extracts 47 acoustic features for the original LGBM/XGBoost tabular model."""
    max_val = float(np.max(np.abs(audio_array))) if len(audio_array) > 0 else 0.0
    if max_val > 1.0:
        audio_array = audio_array / max_val
    elif 0.0 < max_val < 0.1:
        audio_array = audio_array / (max_val + 1e-8)

    try:
        f0, _, _ = librosa.pyin(audio_array, fmin=librosa.note_to_hz("C2"), fmax=librosa.note_to_hz("C7"), sr=sr)
        f0_clean = f0[~np.isnan(f0)] if f0 is not None else np.array([])
    except Exception:
        f0_clean = np.array([])

    pitch_mean = float(np.mean(f0_clean)) if len(f0_clean) > 0 else 130.0
    pitch_std = float(np.std(f0_clean)) if len(f0_clean) > 0 else 15.0
    pitch_max = float(np.max(f0_clean)) if len(f0_clean) > 0 else 180.0
    pitch_min = float(np.min(f0_clean)) if len(f0_clean) > 0 else 90.0

    mfcc = librosa.feature.mfcc(y=audio_array, sr=sr, n_mfcc=20)
    mfcc_mean = np.mean(mfcc, axis=1)
    mfcc_std = np.std(mfcc, axis=1)

    spec_centroid = float(np.mean(librosa.feature.spectral_centroid(y=audio_array, sr=sr)))
    spec_rolloff = float(np.mean(librosa.feature.spectral_rolloff(y=audio_array, sr=sr)))
    zcr = float(np.mean(librosa.feature.zero_crossing_rate(y=audio_array)))

    features = np.hstack([pitch_mean, pitch_std, pitch_max, pitch_min, spec_centroid, spec_rolloff, zcr, mfcc_mean, mfcc_std])
    return features.reshape(1, -1)


def predict_original_model(model, audio_path: str) -> float:
    """Runs inference using the original voice_detector_model.pkl model."""
    audio_array, sr = librosa.load(audio_path, sr=16000, mono=True)
    rms_energy = float(np.sqrt(np.mean(audio_array**2))) if len(audio_array) > 0 else 0.0
    if rms_energy < 0.008:
        return 0.0
    features = extract_legacy_features(audio_array, sr=sr)
    raw_prob = float(model.predict_proba(features)[0][1])
    calibrated_prob = raw_prob * 0.35 if raw_prob < 0.65 else raw_prob
    return calibrated_prob * 100.0


def format_row(cols, widths, alignments=None):
    if alignments is None:
        alignments = ["<"] * len(cols)
    formatted = []
    for col, width, align in zip(cols, widths, alignments):
        if align == ">":
            formatted.append(f"{str(col):>{width}}")
        elif align == "^":
            formatted.append(f"{str(col):^{width}}")
        else:
            formatted.append(f"{str(col):<{width}}")
    return "| " + " | ".join(formatted) + " |"


def run_original_model_benchmark(folder_path: str, model_path: str = "model/voice_detector_model.pkl"):
    print("=" * 88)
    print(" " * 18 + "TRUVOICE ORIGINAL MODEL BENCHMARK (voice_detector_model.pkl)")
    print("=" * 88)

    folder = Path(folder_path)
    if not folder.exists():
        print(f"[!] Folder '{folder_path}' does not exist.")
        return

    if not os.path.exists(model_path):
        print(f"[x] Error: Original model file not found at '{model_path}'.")
        return

    model = joblib.load(model_path)
    audio_files = [f for f in folder.iterdir() if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS]

    if not audio_files:
        print(f"[!] No supported audio files in '{folder_path}'.")
        return

    print(f"[*] Target Folder     : {folder.resolve()}")
    print(f"[*] Audio Files Found : {len(audio_files)}")
    print(f"[*] Model Loaded      : {model_path} ({type(model).__name__})")
    print("-" * 88)

    headers = ["File Name", "% AI Detected", "Inference (ms)"]
    widths = [45, 18, 16]
    aligns = ["<", ">", ">"]
    separator = "+" + "+".join(["-" * (w + 2) for w in widths]) + "+"

    print(separator)
    print(format_row(headers, widths, ["^"] * len(headers)))
    print(separator)

    results = []
    total_time_ms = 0.0

    for file_path in audio_files:
        start_time = time.perf_counter()
        try:
            ai_prob = predict_original_model(model, str(file_path))
            dur_ms = (time.perf_counter() - start_time) * 1000.0
            total_time_ms += dur_ms
            row = [file_path.name[:45], f"{ai_prob:.2f}%", f"{dur_ms:.1f} ms"]
            print(format_row(row, widths, aligns))
            results.append({"name": file_path.name, "prob": ai_prob, "time": dur_ms})
        except Exception as e:
            dur_ms = (time.perf_counter() - start_time) * 1000.0
            row = [file_path.name[:45], "ERROR", f"{dur_ms:.1f} ms"]
            print(format_row(row, widths, aligns))
            print(f"    [!] Error on '{file_path.name}': {e}")

    print(separator)
    if results:
        avg_prob = sum(r["prob"] for r in results) / len(results)
        avg_time = total_time_ms / len(results)
        print("\n" + "=" * 88)
        print(" " * 32 + "ORIGINAL MODEL SUMMARY")
        print("=" * 88)
        print(f"  - Total Files Processed        : {len(results)}")
        print(f"  - Average AI Voice Probability : {avg_prob:.2f}%")
        print(f"  - Average Inference Latency    : {avg_time:.2f} ms")
        print("=" * 88 + "\n")


def run_comparison_benchmark(folder_path: str):
    print("=" * 96)
    print(" " * 24 + "TRUVOICE MODEL COMPARISON: ORIGINAL VS NEW (best_model_fold4)")
    print("=" * 96)

    orig_path = "model/voice_detector_model.pkl"
    if not os.path.exists(orig_path):
        print(f"[x] Original model '{orig_path}' not found.")
        return

    folder = Path(folder_path)
    audio_files = [f for f in folder.iterdir() if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS]

    if not audio_files:
        print(f"[!] No supported audio files in '{folder_path}'.")
        return

    orig_model = joblib.load(orig_path)
    pipeline = get_pipeline()

    headers = ["File Name", "Original Model (% AI)", "New Model (% AI)", "Risk Level", "Latency Diff"]
    widths = [32, 22, 17, 13, 14]
    aligns = ["<", ">", ">", "^", ">"]
    separator = "+" + "+".join(["-" * (w + 2) for w in widths]) + "+"

    print(separator)
    print(format_row(headers, widths, ["^"] * len(headers)))
    print(separator)

    for file_path in audio_files:
        # Original model
        t0 = time.perf_counter()
        orig_ai = predict_original_model(orig_model, str(file_path))
        orig_dur = (time.perf_counter() - t0) * 1000.0

        # New model
        t1 = time.perf_counter()
        res = pipeline.analyze_audio_sample(str(file_path))
        new_dur = (time.perf_counter() - t1) * 1000.0
        new_ai = res.get("ai_voice_probability", 0.0)
        risk = res.get("risk_level", "UNKNOWN")

        row = [
            file_path.name[:32],
            f"{orig_ai:.2f}%",
            f"{new_ai:.2f}%",
            risk,
            f"{new_dur - orig_dur:+.0f} ms",
        ]
        print(format_row(row, widths, aligns))

    print(separator)
    print("=" * 96 + "\n")


def batch_test_voice_folder(folder_path: str = "test_voice", model_path: str = None):
    # Check if model is the original .pkl model
    if model_path and model_path.endswith(".pkl"):
        run_original_model_benchmark(folder_path, model_path)
        return

    print("=" * 88)
    print(" " * 22 + "TRUVOICE AI DETECTION BATCH BENCHMARK")
    print("=" * 88)

    folder = Path(folder_path)
    if not folder.exists():
        print(f"[!] Warning: Directory '{folder_path}' does not exist. Creating it now...")
        folder.mkdir(parents=True, exist_ok=True)
        print(f"[!] Created directory '{folder_path}'. Please place test audio files inside and rerun.\n")
        return

    audio_files = [f for f in folder.iterdir() if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS]

    if not audio_files:
        print(f"[!] No supported audio files found in '{folder_path}'.")
        print(f"    Supported formats: {', '.join(sorted(SUPPORTED_EXTENSIONS))}\n")
        return

    print(f"[*] Target Folder     : {folder.resolve()}")
    print(f"[*] Audio Files Found : {len(audio_files)}")
    print(f"[*] Model Checkpoint  : {model_path or settings.VOICE_MODEL_PATH}")
    print("-" * 88)

    try:
        pipeline = UnifiedPipelineTester(model_path=model_path) if model_path else get_pipeline()
    except Exception as e:
        print(f"[x] Critical Error initializing pipeline: {e}")
        return

    headers = ["File Name", "% AI Detected", "Risk Level", "Unified Risk", "Inference (ms)"]
    widths = [30, 14, 15, 14, 14]
    aligns = ["<", ">", "^", ">", ">"]
    separator = "+" + "+".join(["-" * (w + 2) for w in widths]) + "+"

    print(separator)
    print(format_row(headers, widths, ["^"] * len(headers)))
    print(separator)

    results = []
    total_time_ms = 0.0
    failed_count = 0

    for file_path in audio_files:
        start_time = time.perf_counter()
        try:
            analysis = pipeline.analyze_audio_sample(str(file_path))
            duration_ms = (time.perf_counter() - start_time) * 1000.0
            total_time_ms += duration_ms

            ai_prob = analysis.get("ai_voice_probability", 0.0)
            risk_level = analysis.get("risk_level", "UNKNOWN")
            unified_risk = analysis.get("unified_risk_score", 0.0)

            row = [
                file_path.name[:30],
                f"{ai_prob:.2f}%",
                risk_level,
                f"{unified_risk:.2f}%",
                f"{duration_ms:.1f} ms",
            ]
            print(format_row(row, widths, aligns))
            results.append({
                "file_name": file_path.name,
                "ai_prob": ai_prob,
                "unified_risk": unified_risk,
                "risk_level": risk_level,
                "duration_ms": duration_ms,
            })
        except Exception as err:
            duration_ms = (time.perf_counter() - start_time) * 1000.0
            failed_count += 1
            row = [file_path.name[:30], "ERR", "FAILED", "ERR", f"{duration_ms:.1f} ms"]
            print(format_row(row, widths, aligns))
            print(f"    [!] Error processing '{file_path.name}': {err}")

    print(separator)

    processed_count = len(results)
    if processed_count > 0:
        avg_ai_prob = sum(r["ai_prob"] for r in results) / processed_count
        avg_time_ms = total_time_ms / (processed_count + failed_count)

        print("\n" + "=" * 88)
        print(" " * 32 + "BATCH EXECUTION SUMMARY")
        print("=" * 88)
        print(f"  - Total Audio Files Discovered : {len(audio_files)}")
        print(f"  - Successfully Processed       : {processed_count}")
        print(f"  - Failed / Corrupted Files     : {failed_count}")
        print(f"  - Average AI Voice Probability : {avg_ai_prob:.2f}%")
        print(f"  - Average Inference Latency    : {avg_time_ms:.2f} ms")
        print(f"  - Total Processing Duration    : {total_time_ms / 1000.0:.2f} s")
        print("=" * 88 + "\n")


def main():
    parser = argparse.ArgumentParser(description="Batch-test audio files in test_voice/ using TruVoice pipeline.")
    parser.add_argument(
        "--folder",
        type=str,
        default="test_voice",
        help="Path to folder containing audio files (default: test_voice)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help="Path to model file (.pth or .pkl) (default: best_model_fold4.pth)",
    )
    parser.add_argument(
        "--original",
        action="store_true",
        help="Run benchmark using the original model (voice_detector_model.pkl)",
    )
    parser.add_argument(
        "--compare",
        action="store_true",
        help="Compare original model vs new model side-by-side on all files",
    )
    args = parser.parse_args()

    if args.compare:
        run_comparison_benchmark(args.folder)
    elif args.original:
        run_original_model_benchmark(args.folder, "model/voice_detector_model.pkl")
    else:
        batch_test_voice_folder(args.folder, args.model)


if __name__ == "__main__":
    main()
