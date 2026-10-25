import logging
import os
import sys
import threading
import time
from collections import OrderedDict
from typing import Any, Callable

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
from app.services.transcription_core import (
    get_hinglish_asr_prompt,
    normalize_transcript,
    normalize_and_detect_language,
    preprocess_audio,
    stitch_transcripts,
    transcript_quality,
    transcribe_audio,
)

logger = logging.getLogger(__name__)

class LocalSTTSanitizer:
    """Warm local Whisper ASR followed by Presidio PII redaction and stitching.

    The model and Presidio engines are initialized once and reused for calls.
    """

    def __init__(
        self,
        model_size: str | None = None,
        device: str = "auto",
        compute_type: str | None = None,
        allow_cpu_fallback: bool = True,
    ) -> None:
        model_size = model_size or settings.STT_MODEL_SIZE
        if "turbo" in model_size.casefold():
            raise ValueError("The primary local STT model must be large-v3, not turbo.")
        compute_type = compute_type or settings.STT_COMPUTE_TYPE
        requested_device = self._resolve_device(device)
        requested_compute_type = compute_type if requested_device == "cuda" else "int8"
        self.model_size = model_size
        self.requested_device = requested_device
        self.device = requested_device
        self.beam_size = settings.STT_BEAM_SIZE
        self.language = None if settings.STT_LANGUAGE.lower() == "auto" else settings.STT_LANGUAGE
        self.min_rms = settings.STT_MIN_RMS
        self.min_silence_duration_ms = settings.STT_MIN_SILENCE_DURATION_MS
        self._transcript_sessions: OrderedDict[str, str] = OrderedDict()
        self._session_lock = threading.Lock()
        self._max_transcript_sessions = 256
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

    def _sanitize_transcript(self, text: str) -> str:
        if not text:
            return ""
        try:
            results = self.analyzer.analyze(
                text=text,
                entities=self.target_entities,
                language="en",
            )

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
                text=text,
                analyzer_results=results,
                operators=operators,
            )
            return normalize_transcript(anonymized_result.text)
        except Exception:
            logger.exception("Error during PII anonymization")
            return text

    def _get_transcript_context(self, call_id: str | None) -> str:
        if not call_id:
            return ""
        with self._session_lock:
            return self._transcript_sessions.get(call_id, "")

    def _store_transcript_context(self, call_id: str | None, transcript: str) -> None:
        if not call_id:
            return
        with self._session_lock:
            self._transcript_sessions[call_id] = transcript
            self._transcript_sessions.move_to_end(call_id)
            while len(self._transcript_sessions) > self._max_transcript_sessions:
                self._transcript_sessions.popitem(last=False)

    def clear_transcript_session(self, call_id: str) -> None:
        with self._session_lock:
            self._transcript_sessions.pop(call_id, None)

    def process_audio(
        self,
        audio_path: str,
        call_id: str | None = None,
        on_partial_transcript: (
            Callable[[str, float, str, str, float, float], None] | None
        ) = None,
        on_final_transcript: (
            Callable[[str, float, str, str, float, float], None] | None
        ) = None,
    ) -> dict[str, Any]:
        """
        Decode, gate, transcribe, redact, and stitch a live audio chunk.
        Returns a dictionary with raw and sanitized transcripts and latency.
        """
        processing_start = time.perf_counter()
        first_partial_latency_sec: float | None = None
        partial_sanitization_latency_sec = 0.0
        latest_partial = ""

        def emit_first_segment(
            partial_segments: list[Any],
            partial_confidence: float,
        ) -> None:
            nonlocal first_partial_latency_sec, latest_partial
            nonlocal partial_sanitization_latency_sec
            if first_partial_latency_sec is not None:
                return
            partial_raw = normalize_transcript(
                " ".join(segment.text for segment in partial_segments)
            )
            if not partial_raw:
                return
            if not on_partial_transcript:
                first_partial_latency_sec = time.perf_counter() - processing_start
                return
            partial_normalized, partial_language, language_confidence = (
                normalize_and_detect_language(partial_raw)
            )
            partial_sanitization_start = time.perf_counter()
            partial_sanitized = self._sanitize_transcript(partial_normalized)
            partial_sanitization_latency_sec += (
                time.perf_counter() - partial_sanitization_start
            )
            partial_stitched = stitch_transcripts(previous_transcript, partial_sanitized)
            if not partial_stitched:
                return
            latest_partial = partial_stitched
            first_partial_latency_sec = time.perf_counter() - processing_start
            on_partial_transcript(
                latest_partial,
                partial_confidence,
                transcript_quality(partial_confidence, True),
                partial_language,
                language_confidence,
                first_partial_latency_sec,
            )

        preprocessing_start = time.perf_counter()
        try:
            audio = preprocess_audio(audio_path)
        except Exception as e:
            logger.exception("Error decoding audio for STT")
            raise RuntimeError(f"Unable to decode audio for transcription: {e}") from e
        preprocessing_latency_sec = time.perf_counter() - preprocessing_start

        previous_transcript = self._get_transcript_context(call_id)
        prompt_context = " ".join(previous_transcript.split()[-64:]) or None
        transcription_start = time.perf_counter()
        segments, info, confidence, has_speech = transcribe_audio(
            self.model,
            audio,
            beam_size=self.beam_size,
            language=self.language,
            min_rms=self.min_rms,
            min_silence_duration_ms=self.min_silence_duration_ms,
            initial_prompt=get_hinglish_asr_prompt(prompt_context),
            on_segment=emit_first_segment,
        )
        transcription_latency_sec = time.perf_counter() - transcription_start
        raw_transcript = normalize_transcript(" ".join(segment.text for segment in segments))
        normalized_chunk, transcript_language, language_confidence = (
            normalize_and_detect_language(raw_transcript)
        )

        sanitization_start = time.perf_counter()
        sanitized_transcript = self._sanitize_transcript(normalized_chunk)
        sanitization_latency_sec = (
            partial_sanitization_latency_sec
            + time.perf_counter()
            - sanitization_start
        )

        stitched_transcript = stitch_transcripts(previous_transcript, sanitized_transcript)
        stitched_transcript = " ".join(stitched_transcript.split()[-512:])
        self._store_transcript_context(call_id, stitched_transcript)

        # The first chunk is already sanitized. Re-sanitize only when stitching
        # later chunks to catch PII that straddles an audio-window boundary.
        if previous_transcript:
            scoring_sanitize_start = time.perf_counter()
            scoring_transcript = self._sanitize_transcript(stitched_transcript)
            sanitization_latency_sec += time.perf_counter() - scoring_sanitize_start
        else:
            scoring_transcript = stitched_transcript
        final_stitched_latency_sec = time.perf_counter() - processing_start
        if on_final_transcript and scoring_transcript:
            on_final_transcript(
                scoring_transcript,
                confidence,
                transcript_quality(confidence, has_speech),
                transcript_language,
                language_confidence,
                final_stitched_latency_sec,
            )
        logger.info(
            "Transcription timing call_id=%s time_to_first_partial_sec=%s "
            "time_to_final_stitched_sec=%.3f words=%d confidence=%.4f",
            call_id or "non-live",
            (
                f"{first_partial_latency_sec:.3f}"
                if first_partial_latency_sec is not None
                else "unavailable"
            ),
            final_stitched_latency_sec,
            len(scoring_transcript.split()),
            confidence,
        )
        latency_sec = (
            preprocessing_latency_sec
            + transcription_latency_sec
            + sanitization_latency_sec
        )

        return {
            "raw_transcript": raw_transcript,
            "original_transcript": raw_transcript,
            "normalized_transcript": sanitized_transcript,
            "sanitized_transcript": sanitized_transcript,
            "partial_transcript": latest_partial,
            "stitched_transcript": scoring_transcript,
            "final_transcript": scoring_transcript,
            "transcript_confidence": confidence,
            "transcript_quality": transcript_quality(confidence, has_speech),
            "detected_language": getattr(info, "language", None) if info else None,
            "transcript_language": transcript_language,
            "transcript_language_confidence": language_confidence,
            # Kept for existing API clients; this includes transcription + redaction.
            "stt_latency_sec": latency_sec,
            "audio_preprocessing_latency_sec": preprocessing_latency_sec,
            "transcription_latency_sec": transcription_latency_sec,
            "sanitization_latency_sec": sanitization_latency_sec,
            "time_to_first_partial_sec": first_partial_latency_sec,
            "time_to_final_stitched_sec": final_stitched_latency_sec,
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


def clear_transcript_session(call_id: str) -> None:
    if _local_stt_instance is not None:
        _local_stt_instance.clear_transcript_session(call_id)
