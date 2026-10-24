import logging
import os
import sys
import time
from typing import Any

# Workaround for Windows CUDA DLL loading issue in ctranslate2/faster-whisper
if sys.platform == "win32":
    try:
        import torch
        torch_lib = os.path.join(os.path.dirname(torch.__file__), "lib")
        if os.path.exists(torch_lib):
            os.add_dll_directory(torch_lib)
    except Exception as e:
        logging.warning(f"Could not add torch lib to DLL search path: {e}")

from faster_whisper import WhisperModel
from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig
from app.config import settings

logger = logging.getLogger(__name__)

class LocalSTTSanitizer:
    """Local Whisper transcription followed by Presidio PII redaction.

    ``faster-whisper`` performs transcription on CUDA when it is available.
    Presidio's default spaCy model is CPU-bound, so its time is reported
    separately from the transcription latency.
    """

    def __init__(
        self,
        model_size: str | None = None,
        device: str = "auto",
        compute_type: str | None = None,
        allow_cpu_fallback: bool = True,
    ) -> None:
        model_size = model_size or settings.STT_MODEL_SIZE
        compute_type = compute_type or settings.STT_COMPUTE_TYPE
        requested_device = self._resolve_device(device)
        requested_compute_type = compute_type if requested_device == "cuda" else "int8"
        self.model_size = model_size
        self.requested_device = requested_device
        self.device = requested_device
        logger.info(
            "Loading faster-whisper model '%s' on %s (%s)...",
            model_size,
            requested_device,
            requested_compute_type,
        )
        try:
            self.model = WhisperModel(
                model_size,
                device=requested_device,
                compute_type=requested_compute_type,
            )
        except Exception as e:
            if requested_device != "cuda" or not allow_cpu_fallback:
                raise RuntimeError(
                    f"Unable to load faster-whisper on {requested_device}. "
                    "Install a CUDA-compatible CTranslate2 build or use --device cpu."
                ) from e
            logger.warning("Failed to load WhisperModel on CUDA (%s); falling back to CPU.", e)
            self.model = WhisperModel(model_size, device="cpu", compute_type="int8")
            self.device = "cpu"

        logger.info("Initializing Presidio Analyzer and Anonymizer...")
        from presidio_analyzer.nlp_engine import NlpEngineProvider
        try:
            import spacy
            spacy.load("en_core_web_sm")
        except OSError as exc:
            raise RuntimeError(
                "Presidio requires the spaCy model 'en_core_web_sm'. "
                "Install project dependencies with: pip install -r requirements.txt"
            ) from exc
        configuration = {
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
        }
        provider = NlpEngineProvider(nlp_configuration=configuration)
        nlp_engine = provider.create_engine()
        self.analyzer = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["en"])
        self._register_domain_recognizers()
        self.anonymizer = AnonymizerEngine()
        
        # We target specific PII entities relevant to financial/personal security
        self.target_entities = [
            "PHONE_NUMBER",
            "PERSON",
            "EMAIL_ADDRESS",
            "BANK_ACCOUNT",
            "CREDIT_CARD",
            "US_SSN",
            "UK_NHS",
            "DATE_OF_BIRTH",
        ]

    def _register_domain_recognizers(self) -> None:
        """Add India-friendly patterns missed by Presidio's default recognizers.

        Account numbers commonly appear in voice transcripts as 6--18 plain
        digits. Dates are only marked as DOB when a nearby DOB-related phrase
        raises the recognizer confidence, preventing ordinary amounts such as
        ``5,543 rupees`` from being redacted.
        """
        self.analyzer.registry.add_recognizer(
            PatternRecognizer(
                supported_entity="BANK_ACCOUNT",
                name="bank_account_number_recognizer",
                patterns=[
                    Pattern(
                        name="account_number",
                        regex=r"(?<!\d)(?:\d[ -]?){5,17}\d(?!\d)",
                        score=0.85,
                    )
                ],
                context=["account number", "bank account", "a/c number"],
            )
        )
        self.analyzer.registry.add_recognizer(
            PatternRecognizer(
                supported_entity="DATE_OF_BIRTH",
                name="date_of_birth_recognizer",
                patterns=[
                    Pattern(
                        name="written_date",
                        regex=(
                            r"\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|"
                            r"jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|"
                            r"nov(?:ember)?|dec(?:ember)?)\s+(?:0?[1-9]|[12]\d|3[01])"
                            r"(?:st|nd|rd|th)?,?\s+(?:19|20)\d{2}\b"
                        ),
                        score=0.75,
                    ),
                    Pattern(
                        name="numeric_date",
                        regex=r"\b(?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])[-/.](?:19|20)\d{2}\b",
                        score=0.75,
                    ),
                    Pattern(
                        name="written_date_day_first",
                        regex=(
                            r"\b(?:0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\s+"
                            r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|"
                            r"jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|"
                            r"nov(?:ember)?|dec(?:ember)?)\s+(?:19|20)\d{2}\b"
                        ),
                        score=0.75,
                    ),
                ],
                context=["date of birth", "date birth", "dob", "born", "birth date"],
            )
        )
        self.analyzer.registry.add_recognizer(
            PatternRecognizer(
                supported_entity="PERSON",
                name="account_holder_name_recognizer",
                patterns=[
                    Pattern(
                        name="account_handler_name",
                        regex=r"(?<=account handler is )[A-Za-z][A-Za-z' -]{1,80}(?=[.,;]|$)",
                        score=0.9,
                    ),
                    Pattern(
                        name="account_holder_name",
                        regex=r"(?<=account holder is )[A-Za-z][A-Za-z' -]{1,80}(?=[.,;]|$)",
                        score=0.9,
                    ),
                    Pattern(
                        name="registered_account_name",
                        regex=r"(?<=registered to )[A-Za-z][A-Za-z' -]{1,80}(?=[.,;]|$)",
                        score=0.9,
                    ),
                ],
            )
        )

    @staticmethod
    def _resolve_device(device: str) -> str:
        if device not in {"auto", "cuda", "cpu"}:
            raise ValueError("device must be one of: auto, cuda, cpu")
        if device != "auto":
            return device
        try:
            import torch
            return "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            return "cpu"

    def process_audio(self, audio_path: str) -> dict[str, Any]:
        """
        Transcribes the audio file and scrubs PII from the transcript.
        Returns a dictionary with raw and sanitized transcripts and latency.
        """
        # 1. Transcribe with faster-whisper
        transcription_start = time.perf_counter()
        try:
            segments, info = self.model.transcribe(audio_path, beam_size=5, language="en")
            raw_transcript = " ".join([segment.text for segment in segments]).strip()
        except Exception as e:
            logger.error(f"Error during STT transcription: {e}")
            raw_transcript = ""
        transcription_latency_sec = time.perf_counter() - transcription_start

        # 2. PII Sanitization with Presidio
        sanitization_start = time.perf_counter()
        sanitized_transcript = raw_transcript
        if raw_transcript:
            try:
                results = self.analyzer.analyze(text=raw_transcript, entities=self.target_entities, language='en')
                
                # Use specific tags instead of generic <REDACTED>
                operators = {
                    "PHONE_NUMBER": OperatorConfig("replace", {"new_value": "[PHONE_NUMBER]"}),
                    "PERSON": OperatorConfig("replace", {"new_value": "[PERSON]"}),
                    "EMAIL_ADDRESS": OperatorConfig("replace", {"new_value": "[EMAIL]"}),
                    "BANK_ACCOUNT": OperatorConfig("replace", {"new_value": "[BANK_ACCOUNT]"}),
                    "CREDIT_CARD": OperatorConfig("replace", {"new_value": "[CREDIT_CARD]"}),
                    "US_SSN": OperatorConfig("replace", {"new_value": "[SSN]"}),
                    "UK_NHS": OperatorConfig("replace", {"new_value": "[NHS]"}),
                    "DATE_OF_BIRTH": OperatorConfig("replace", {"new_value": "[DATE_OF_BIRTH]"}),
                }
                
                anonymized_result = self.anonymizer.anonymize(
                    text=raw_transcript,
                    analyzer_results=results,
                    operators=operators
                )
                sanitized_transcript = anonymized_result.text
            except Exception as e:
                logger.error(f"Error during PII anonymization: {e}")
                sanitized_transcript = raw_transcript
        sanitization_latency_sec = time.perf_counter() - sanitization_start
        latency_sec = transcription_latency_sec + sanitization_latency_sec
        
        return {
            "raw_transcript": raw_transcript,
            "sanitized_transcript": sanitized_transcript,
            # Kept for existing API clients; this includes transcription + redaction.
            "stt_latency_sec": latency_sec,
            "transcription_latency_sec": transcription_latency_sec,
            "sanitization_latency_sec": sanitization_latency_sec,
            "device": self.device,
            "model_size": self.model_size,
        }

# Singleton instance
_local_stt_instance = None

def get_local_stt():
    global _local_stt_instance
    if _local_stt_instance is None:
        _local_stt_instance = LocalSTTSanitizer()
    return _local_stt_instance
