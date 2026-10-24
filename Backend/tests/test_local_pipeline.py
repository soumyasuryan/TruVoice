import os
import sys
from pathlib import Path
import time
import unittest

root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from app.utils.pipeline import get_pipeline

class TestLocalPipeline(unittest.TestCase):
    def test_local_gpu_pipeline(self):
        pipeline = get_pipeline()
        
        test_dir = "test_voice"
        if not os.path.exists(test_dir):
            print(f"\n[!] Test directory '{test_dir}' not found. Please create it and add audio files.")
            return

        audio_files = [f for f in os.listdir(test_dir) if f.lower().endswith((".wav", ".mp3", ".m4a"))]
        
        if not audio_files:
            print(f"\n[!] No supported audio files found in '{test_dir}'.")
            return

        print("\n" + "=" * 120)
        print(f"  LOCAL CUDA-ACCELERATED STT & PII PIPELINE BENCHMARK")
        print("=" * 120)
        
        headers = ["File Name", "STT Latency (s)", "Raw Transcript", "Sanitized Transcript", "Scam Score", "Risk Level"]
        widths = [20, 15, 30, 30, 12, 12]
        
        def format_row(row):
            formatted = []
            for item, width in zip(row, widths):
                s = str(item)
                if len(s) > width:
                    s = s[:width - 3] + "..."
                formatted.append(f"{s:<{width}}")
            return " | ".join(formatted)

        print(format_row(headers))
        print("-" * 120)
        
        for audio_file in audio_files:
            audio_path = os.path.join(test_dir, audio_file)
            
            try:
                result = pipeline.analyze_audio_sample(audio_path)
                
                row = [
                    audio_file,
                    f"{result.get('stt_latency_sec', 0.0):.2f}",
                    result.get("raw_transcript", ""),
                    result.get("transcript", ""),
                    f"{result.get('scam_intent_score', 0.0)}%",
                    result.get("risk_level", "SAFE")
                ]
                print(format_row(row))
                
                print(f"\n  -> Reason: {result.get('reasoning')}")
                print(f"  -> UI Alert: {result.get('ui_alert')}\n")
                
            except Exception as e:
                print(format_row([audio_file, "ERROR", str(e), "", "", ""]))
                
        print("=" * 120 + "\n")

if __name__ == "__main__":
    unittest.main()
