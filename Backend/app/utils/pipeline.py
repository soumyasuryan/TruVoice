import logging
import os
from typing import Optional

from app.ai_voice.voice_detector import VoiceDetector
from app.services.local_stt import get_local_stt
from app.config import settings
from src.scam_detector import GroqScamDetector

logger = logging.getLogger(__name__)


class UnifiedPipelineTester:
    """
    Unified AI Analysis Pipeline:
    1. AI Voice Detection: Neural Wav2Vec2 deepfake detector (best_model_fold4.pth).
    2. Scam Intent Detection: Groq Whisper + LLaMA NLP transcript analysis.
    3. Output Standardization: Computes unified risk and returns standardized dictionary containing '% ai detected'.
    """

    def __init__(self, model_path: Optional[str] = None):
        target_model_path = model_path or settings.VOICE_MODEL_PATH

        if not os.path.exists(target_model_path):
            error_msg = f"Voice detection model checkpoint not found: {target_model_path}"
            logger.error(error_msg)
            raise FileNotFoundError(error_msg)

        # Initialize Neural Voice Detector (Wav2Vec2 backbone)
        self.voice_detector = VoiceDetector(
            model_path=target_model_path,
            device="auto",
            threshold=settings.VOICE_THRESHOLD,
            min_rms=settings.VOICE_MIN_RMS,
        )

        if not settings.GROQ_API_KEY:
            raise ValueError("GROQ_API_KEY environment variable is missing.")

        # Initialize Groq NLP Scam Intent Detector
        self.scam_detector = GroqScamDetector(api_key=settings.GROQ_API_KEY)
        
        # Initialize Local STT and Sanitizer
        self.local_stt = get_local_stt()

    def analyze_audio_sample(self, audio_path: str) -> dict:
        """
        Executes dual AI analysis pipeline:
        1. AI-Voice Detection -> Returns % ai detected (ai_voice_probability in range [0.0, 100.0]).
        2. Groq Scam Intent Detection -> Returns scam_intent_score in range [0.0, 100.0].
        3. Unified Risk Formula -> Max-Weighted Hybrid:
           unified = max(ai, scam) * 0.7  +  (ai * scam) * 0.3
        4. Threat Classification -> risk_level, threat_type, ui_alert based on threshold matrix.
        """
        # Step 1: Neural Voice Deepfake Detection
        voice_result = self.voice_detector.predict(audio_path)
        ai_voice_prob = float(voice_result.get("spoof_probability", 0.0))  # 0.0 to 1.0

        # Step 2: Local STT & PII Sanitization
        stt_result = self.local_stt.process_audio(audio_path)
        sanitized_transcript = stt_result.get("sanitized_transcript", "")
        raw_transcript = stt_result.get("raw_transcript", "")
        stt_latency_sec = stt_result.get("stt_latency_sec", 0.0)

        # Step 3: Groq NLP Scam Intent Detection (using sanitized transcript)
        nlp_result = self.scam_detector.analyze_scam_intent(sanitized_transcript)
        scam_text_score = float(nlp_result.get("scam_score", 0.0))  # 0.0 to 1.0

        # Step 4: Unified Risk Score — Max-Weighted Hybrid Formula
        # Single-factor spikes (AI-only or Scam-only) properly elevate risk
        # instead of being suppressed like in a pure multiplicative model.
        unified_risk = (max(ai_voice_prob, scam_text_score) * 0.7) + ((ai_voice_prob * scam_text_score) * 0.3)
        trust_score = max(0.0, min(100.0, 100.0 - (unified_risk * 100.0)))

        # Step 5: Threat Classification & UI Alert Messaging
        if ai_voice_prob >= 0.65 and scam_text_score >= 0.60:
            risk_level = "SEVERE"
            threat_type = "AI_CLONE_SCAM"
            ui_alert = "DANGER: Fake AI Voice Scam Call!"
        elif ai_voice_prob >= 0.65 and scam_text_score < 0.60:
            risk_level = "MODERATE"
            threat_type = "GENERATED_VOICE"
            ui_alert = "CAUTION: Caller is using a computer-generated voice"
        elif ai_voice_prob < 0.65 and scam_text_score >= 0.60:
            risk_level = "MODERATE"
            threat_type = "SUSPICIOUS_CALLER"
            ui_alert = "CAUTION: Conversation shows signs of a scam"
        else:
            risk_level = "SAFE"
            threat_type = "NORMAL"
            ui_alert = "This call looks safe."

        logger.info(
            f"[PIPELINE SUMMARY] File: {os.path.basename(audio_path)} | AI Voice: {ai_voice_prob * 100:.2f}% | "
            f"Scam Intent: {scam_text_score * 100:.2f}% | Unified Risk: {unified_risk * 100:.2f}% | "
            f"Level: {risk_level} | Threat: {threat_type}"
        )

        return {
            "file_name": os.path.basename(audio_path),
            "transcript": sanitized_transcript,
            "raw_transcript": raw_transcript,
            "stt_latency_sec": round(stt_latency_sec, 2),
            "ai_voice_probability": round(ai_voice_prob * 100, 2),
            "scam_intent_score": round(scam_text_score * 100, 2),
            "unified_risk_score": round(unified_risk * 100, 2),
            "trust_score": round(trust_score, 2),
            "risk_level": risk_level,
            "threat_type": threat_type,
            "ui_alert": ui_alert,
            "scam_category": nlp_result.get("category", "N/A"),
            "flagged_keywords": nlp_result.get("risk_keywords", []),
            "reasoning": nlp_result.get("reasoning", ""),
        }


# Singleton instance
pipeline_engine = None


def get_pipeline():
    global pipeline_engine
    if pipeline_engine is None:
        pipeline_engine = UnifiedPipelineTester()
    return pipeline_engine
