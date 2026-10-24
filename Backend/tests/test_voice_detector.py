import os
import unittest
import numpy as np
import torch
from pathlib import Path

from app.ai_voice.voice_detector import VoiceDetector
from app.config import settings
from app.utils.pipeline import get_pipeline, UnifiedPipelineTester


class TestVoiceDetector(unittest.TestCase):
    """
    Unit test suite validating VoiceDetector and Unified Pipeline with REAL model weights:
    - Loads model/best_model_fold4.pth directly (no dummy mocks).
    - Evaluates and displays all scores: AI Voice, Groq Scam, Unified Risk, Threat Type, UI Alert.
    - Validates the Max-Weighted Hybrid Scoring Model.
    """

    @classmethod
    def setUpClass(cls):
        cls.model_path = settings.VOICE_MODEL_PATH
        if not os.path.exists(cls.model_path):
            raise FileNotFoundError(f"Real model weights not found at '{cls.model_path}'.")

        # Initialize real detector and pipeline
        cls.detector = VoiceDetector(model_path=cls.model_path, device="auto")
        cls.pipeline = get_pipeline()

        # Discover test audio files
        cls.test_voice_dir = Path("test_voice")
        cls.audio_files = []
        if cls.test_voice_dir.exists():
            supported = {".wav", ".mp3", ".flac", ".m4a", ".ogg", ".mpeg", ".aac", ".opus"}
            cls.audio_files = [f for f in cls.test_voice_dir.iterdir() if f.is_file() and f.suffix.lower() in supported]

        # Fallback single file
        cls.test_audio = "test_speech.wav"
        if not os.path.exists(cls.test_audio) and cls.audio_files:
            cls.test_audio = str(cls.audio_files[0])

    def test_real_model_loading_and_direct_inference(self):
        """
        Validates that real Wav2Vec2 model weights load properly and perform inference.
        """
        dummy_waveform = np.ones(16000, dtype=np.float32) * 0.05
        result = self.detector.predict(dummy_waveform)

        print("\n" + "=" * 70)
        print("  [TEST 1] REAL MODEL DIRECT INFERENCE TEST")
        print("=" * 70)
        print(f"  Model Path            : {self.detector.model_path}")
        print(f"  Device Allocated      : {self.detector.device}")
        print(f"  Spoof Probability (AI): {result['spoof_probability'] * 100:.2f}%")
        print(f"  Human Probability     : {result['bonafide_probability'] * 100:.2f}%")
        print(f"  Predicted Label       : {result['prediction'].upper()}")
        print(f"  RMS Audio Energy      : {result['rms_energy']:.6f}")
        print("=" * 70)

        self.assertIn("spoof_probability", result)
        self.assertIn("bonafide_probability", result)
        self.assertIn("prediction", result)
        self.assertGreaterEqual(result["spoof_probability"], 0.0)
        self.assertLessEqual(result["spoof_probability"], 1.0)
        self.assertAlmostEqual(
            result["spoof_probability"] + result["bonafide_probability"], 1.0, places=4
        )

    def test_pipeline_all_scores_single_file(self):
        """
        Executes end-to-end pipeline on a single file and verifies all output fields
        including the new threat_type and ui_alert.
        """
        if not os.path.exists(self.test_audio):
            self.skipTest(f"Test audio file '{self.test_audio}' not found.")

        result = self.pipeline.analyze_audio_sample(self.test_audio)

        ai_score = result.get("ai_voice_probability", 0.0)
        scam_score = result.get("scam_intent_score", 0.0)
        unified = result.get("unified_risk_score", 0.0)
        risk_level = result.get("risk_level", "UNKNOWN")
        threat_type = result.get("threat_type", "UNKNOWN")
        ui_alert = result.get("ui_alert", "")

        print("\n" + "=" * 80)
        print("  [TEST 2] TRUVOICE PIPELINE — SINGLE FILE SCORE BREAKDOWN")
        print("=" * 80)
        print(f"  Audio File            : {result.get('file_name')}")
        print(f"  Transcript            : \"{result.get('transcript', '')}\"")
        print("  " + "-" * 76)
        print(f"  1. AI Model Score     : {ai_score:.2f}%  (% AI Detected)")
        print(f"  2. Groq Scam Score    : {scam_score:.2f}%  (Transcript NLP Risk)")
        print("  " + "-" * 76)
        print(f"  >>> Groq Intent Analysis Output:")
        print(f"      Scam Category     : {result.get('scam_category', 'N/A')}")
        print(f"      Flagged Keywords  : {result.get('flagged_keywords', [])}")
        print(f"      Reasoning         : {result.get('reasoning', 'N/A')}")
        print("  " + "-" * 76)
        print(f"  3. Unified Risk Score : {unified:.2f}%  (Max-Weighted Hybrid)")
        print(f"  4. Risk Level         : {risk_level}")
        print(f"  5. Threat Type        : {threat_type}")
        print(f"  6. UI Alert           : {ui_alert}")
        print("=" * 80 + "\n")

        # Verify all expected fields exist and are well-typed
        self.assertIsInstance(ai_score, float)
        self.assertIsInstance(scam_score, float)
        self.assertIsInstance(unified, float)
        self.assertIn(risk_level, ["SEVERE", "MODERATE", "SAFE"])
        self.assertIn(threat_type, ["AI_CLONE_SCAM", "GENERATED_VOICE", "SUSPICIOUS_CALLER", "NORMAL"])
        self.assertTrue(len(ui_alert) > 0)

        # Verify hybrid formula: unified = max(ai,scam)*0.7 + (ai*scam)*0.3
        ai_norm = ai_score / 100.0
        scam_norm = scam_score / 100.0
        expected = round((max(ai_norm, scam_norm) * 0.7 + (ai_norm * scam_norm) * 0.3) * 100.0, 2)
        self.assertAlmostEqual(unified, expected, places=1)

    def test_pipeline_batch_test_voice_folder(self):
        """
        Iterates through all audio files in test_voice/ and logs live results
        with all 6 output fields.
        """
        if not self.audio_files:
            self.skipTest("No audio files found in test_voice/ directory.")

        print("\n" + "=" * 110)
        print("  [TEST 3] TRUVOICE PIPELINE — BATCH test_voice/ FOLDER")
        print("=" * 110)
        header = (
            f"  {'File Name':<35} | {'AI %':>7} | {'Scam %':>7} | {'Unified':>8} | "
            f"{'Risk Level':<14} | {'Threat Type':<22} | UI Alert"
        )
        print(header)
        print("  " + "-" * 106)

        for audio_path in self.audio_files:
            result = self.pipeline.analyze_audio_sample(str(audio_path))

            ai = result.get("ai_voice_probability", 0.0)
            scam = result.get("scam_intent_score", 0.0)
            unified = result.get("unified_risk_score", 0.0)
            risk = result.get("risk_level", "?")
            threat = result.get("threat_type", "?")
            alert = result.get("ui_alert", "?")

            print(
                f"  {audio_path.name[:35]:<35} | {ai:6.2f}% | {scam:6.2f}% | {unified:7.2f}% | "
                f"{risk:<14} | {threat:<22} | {alert}"
            )

            # Verify schema integrity for every file
            self.assertIn("ai_voice_probability", result)
            self.assertIn("scam_intent_score", result)
            self.assertIn("unified_risk_score", result)
            self.assertIn("risk_level", result)
            self.assertIn("threat_type", result)
            self.assertIn("ui_alert", result)

        print("=" * 110 + "\n")

    def test_silence_rms_gate(self):
        """
        Validates that completely silent audio triggers the RMS silence gate (0.0% AI Detected).
        """
        silent_waveform = np.zeros(16000, dtype=np.float32)
        result = self.detector.predict(silent_waveform)

        self.assertEqual(result["spoof_probability"], 0.0)
        self.assertEqual(result["bonafide_probability"], 1.0)
        self.assertEqual(result["prediction"], "bonafide")


class TestHybridScoringModel(unittest.TestCase):
    """
    Validates the Max-Weighted Hybrid Unified Risk Scoring formula:
        unified_risk = max(S_AI, S_Scam) * 0.7 + (S_AI * S_Scam) * 0.3

    Tests four canonical scenarios with corresponding threat_type and ui_alert.
    """

    @staticmethod
    def _compute_hybrid(ai_pct: float, scam_pct: float) -> float:
        """Compute unified risk % from two percentage inputs using the hybrid formula."""
        ai = ai_pct / 100.0
        scam = scam_pct / 100.0
        unified = (max(ai, scam) * 0.7) + ((ai * scam) * 0.3)
        return round(unified * 100.0, 2)

    @staticmethod
    def _classify(ai_pct: float, scam_pct: float) -> tuple:
        """Mirrors the threat classification logic in pipeline.py."""
        ai = ai_pct / 100.0
        scam = scam_pct / 100.0
        if ai >= 0.65 and scam >= 0.60:
            return "SEVERE", "AI_CLONE_SCAM", "DANGER: Fake AI Voice Scam Call!"
        elif ai >= 0.65 and scam < 0.60:
            return "MODERATE", "GENERATED_VOICE", "CAUTION: Caller is using a computer-generated voice"
        elif ai < 0.65 and scam >= 0.60:
            return "MODERATE", "SUSPICIOUS_CALLER", "CAUTION: Conversation shows signs of a scam"
        else:
            return "SAFE", "NORMAL", "This call looks safe."

    def _print_scenario(self, label, ai, scam, unified, risk, threat, alert):
        print(
            f"  {label:<40} | AI: {ai:5.1f}% | Scam: {scam:5.1f}% | "
            f"Unified: {unified:6.2f}% | {risk:<14} | {threat:<22} | {alert}"
        )

    def test_scenario_1_high_ai_high_scam(self):
        """HIGH AI (90%) + HIGH Scam (90%) => CRITICAL RISK ~87.30%"""
        ai, scam = 90.0, 90.0
        unified = self._compute_hybrid(ai, scam)
        risk, threat, alert = self._classify(ai, scam)

        print("\n" + "=" * 130)
        print("  [TEST 5] HYBRID SCORING MODEL — 4 CANONICAL SCENARIOS")
        print("=" * 130)
        self._print_scenario("Scenario 1: AI Voice + Scam Intent", ai, scam, unified, risk, threat, alert)

        self.assertAlmostEqual(unified, 87.3, places=1)
        self.assertEqual(risk, "SEVERE")
        self.assertEqual(threat, "AI_CLONE_SCAM")
        self.assertEqual(alert, "DANGER: Fake AI Voice Scam Call!")

    def test_scenario_2_high_ai_low_scam(self):
        """HIGH AI (90%) + LOW Scam (10%) => HIGH RISK ~65.70%"""
        ai, scam = 90.0, 10.0
        unified = self._compute_hybrid(ai, scam)
        risk, threat, alert = self._classify(ai, scam)

        self._print_scenario("Scenario 2: AI Voice + Legit Intent", ai, scam, unified, risk, threat, alert)

        self.assertAlmostEqual(unified, 65.7, places=1)
        self.assertEqual(risk, "MODERATE")
        self.assertEqual(threat, "GENERATED_VOICE")
        self.assertEqual(alert, "CAUTION: Caller is using a computer-generated voice")

    def test_scenario_3_low_ai_high_scam(self):
        """LOW AI (10%) + HIGH Scam (90%) => HIGH RISK ~65.70%"""
        ai, scam = 10.0, 90.0
        unified = self._compute_hybrid(ai, scam)
        risk, threat, alert = self._classify(ai, scam)

        self._print_scenario("Scenario 3: Human Voice + Scam Intent", ai, scam, unified, risk, threat, alert)

        self.assertAlmostEqual(unified, 65.7, places=1)
        self.assertEqual(risk, "MODERATE")
        self.assertEqual(threat, "SUSPICIOUS_CALLER")
        self.assertEqual(alert, "CAUTION: Conversation shows signs of a scam")

    def test_scenario_4_low_ai_low_scam(self):
        """LOW AI (10%) + LOW Scam (10%) => LOW RISK ~7.30%"""
        ai, scam = 10.0, 10.0
        unified = self._compute_hybrid(ai, scam)
        risk, threat, alert = self._classify(ai, scam)

        self._print_scenario("Scenario 4: Human Voice + Legit Intent", ai, scam, unified, risk, threat, alert)
        print("=" * 130 + "\n")

        self.assertAlmostEqual(unified, 7.3, places=1)
        self.assertEqual(risk, "SAFE")
        self.assertEqual(threat, "NORMAL")
        self.assertEqual(alert, "This call looks safe.")


if __name__ == "__main__":
    unittest.main()
