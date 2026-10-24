import logging
import os
from typing import Any, Dict, Union
import numpy as np
import torch
from app.ai_voice.preprocessing import preprocess_audio_waveform
from app.ai_voice.voice_detector_model import DeepfakeAudioClassifier
from app.config import settings

logger = logging.getLogger(__name__)


class VoiceDetector:
    """
    Dedicated Neural Deepfake Voice Detector service layer.
    Loads and runs inference using best_model_fold4.pth (Wav2Vec2 backbone + Classifier head).
    """

    def __init__(
        self,
        model_path: str = None,
        device: str = "auto",
        threshold: float = None,
        min_rms: float = None,
    ):
        target_path = model_path or getattr(settings, "VOICE_MODEL_PATH", "model/best_model_fold4.pth")
        if not os.path.exists(target_path):
            error_msg = f"Voice detection model checkpoint not found: {target_path}"
            logger.error(error_msg)
            raise FileNotFoundError(error_msg)

        if device == "auto":
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            self.device = torch.device(device)

        self.threshold = float(threshold if threshold is not None else getattr(settings, "VOICE_THRESHOLD", 0.5))
        self.min_rms = float(min_rms if min_rms is not None else getattr(settings, "VOICE_MIN_RMS", 0.003))
        self.model_path = target_path

        try:
            checkpoint = torch.load(target_path, map_location=self.device, weights_only=False)
        except Exception as e:
            error_msg = f"Failed to load model checkpoint at '{target_path}': {e}"
            logger.error(error_msg)
            raise RuntimeError(error_msg) from e

        # Instantiate model architecture and load state dictionary
        self.model = DeepfakeAudioClassifier(num_classes=2)
        state_dict = checkpoint.get("model_state_dict", checkpoint) if isinstance(checkpoint, dict) else checkpoint
        try:
            missing_keys, unexpected_keys = self.model.load_state_dict(state_dict, strict=False)
            if missing_keys or unexpected_keys:
                logger.warning(
                    f"Model load warnings - Missing keys: {len(missing_keys)}, Unexpected keys: {len(unexpected_keys)}"
                )
        except Exception as e:
            error_msg = f"State dict mismatch loading voice detector model: {e}"
            logger.error(error_msg)
            raise RuntimeError(error_msg) from e

        self.model.to(self.device)
        self.model.eval()

        logger.info(f"VoiceDetector initialized successfully from '{target_path}' on device '{self.device}'.")

    def predict(
        self,
        audio_input: Union[str, bytes, np.ndarray, torch.Tensor],
        sample_rate: int = 16000,
    ) -> Dict[str, Any]:
        """
        Executes AI voice deepfake detection on input audio.
        Returns:
            {
                "spoof_probability": float (0.0 to 1.0),
                "bonafide_probability": float (0.0 to 1.0),
                "prediction": "spoof" | "bonafide",
                "rms_energy": float
            }
        """
        waveform, rms_energy = preprocess_audio_waveform(
            audio_input=audio_input,
            sample_rate=sample_rate,
            target_sample_rate=16000,
        )

        # Silence / Low Energy Gate: If clip contains no active voice speech, return bonafide (safe)
        if rms_energy < self.min_rms:
            logger.debug(f"Audio RMS energy ({rms_energy:.6f}) below minimum threshold ({self.min_rms}); marking bonafide.")
            return {
                "spoof_probability": 0.0,
                "bonafide_probability": 1.0,
                "prediction": "bonafide",
                "rms_energy": rms_energy,
            }

        waveform = waveform.to(self.device)

        with torch.inference_mode():
            logits = self.model(waveform)
            probabilities = torch.softmax(logits, dim=1)

            # Class mapping: Class 0 = Spoof / AI; Class 1 = Bonafide / Human
            spoof_prob = float(probabilities[0, 0].item())
            bonafide_prob = float(probabilities[0, 1].item())

        prediction = "spoof" if spoof_prob >= self.threshold else "bonafide"

        logger.info(
            f"[VOICE MODEL] Inference result: AI={spoof_prob * 100:.2f}%, Human={bonafide_prob * 100:.2f}% | RMS Energy={rms_energy:.5f} | Prediction={prediction.upper()}"
        )

        return {
            "spoof_probability": spoof_prob,
            "bonafide_probability": bonafide_prob,
            "prediction": prediction,
            "rms_energy": rms_energy,
        }
