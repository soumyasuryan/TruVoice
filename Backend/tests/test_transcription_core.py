import threading
from collections import OrderedDict
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

from app.services.local_stt import LocalSTTSanitizer
from app.services.transcription_core import (
    detect_transcript_language,
    get_hinglish_asr_prompt,
    has_speech_energy,
    normalize_and_detect_language,
    normalize_hinglish_transcript,
    normalize_transcript,
    stitch_transcripts,
    transcribe_audio,
)


class FakeWhisperModel:
    def __init__(self, segments):
        self.segments = segments
        self.calls = []

    def transcribe(self, audio, **kwargs):
        self.calls.append((audio, kwargs))
        return iter(self.segments), SimpleNamespace(language_probability=0.95)


class TranscriptionCoreTests(unittest.TestCase):
    def test_silence_is_gated_before_asr(self):
        model = FakeWhisperModel([])

        segments, info, confidence, has_speech = transcribe_audio(
            model,
            np.zeros(80, dtype=np.float32),
            beam_size=5,
            language=None,
            min_rms=0.003,
            min_silence_duration_ms=300,
        )

        self.assertFalse(has_speech)
        self.assertEqual(segments, [])
        self.assertIsNone(info)
        self.assertEqual(confidence, 0.0)
        self.assertEqual(model.calls, [])

    def test_non_silent_audio_uses_whisper_vad(self):
        model = FakeWhisperModel(
            [SimpleNamespace(text="hello caller", avg_logprob=-0.1, no_speech_prob=0.02)]
        )

        segments, _info, confidence, has_speech = transcribe_audio(
            model,
            np.full(80, 0.1, dtype=np.float32),
            beam_size=5,
            language=None,
            min_rms=0.003,
            min_silence_duration_ms=300,
        )

        self.assertTrue(has_speech)
        self.assertEqual(len(segments), 1)
        self.assertGreater(confidence, 0.0)
        self.assertTrue(model.calls[0][1]["vad_filter"])
        self.assertIsNone(model.calls[0][1]["language"])

    def test_fast_speaker_emits_first_segment_before_final_decode(self):
        model = FakeWhisperModel(
            [
                SimpleNamespace(text="I need to", avg_logprob=-0.1, no_speech_prob=0.01),
                SimpleNamespace(text=" verify your bank account immediately", avg_logprob=-0.2, no_speech_prob=0.02),
            ]
        )
        partials = []

        segments, _info, _confidence, _has_speech = transcribe_audio(
            model,
            np.full(80, 0.1, dtype=np.float32),
            beam_size=5,
            language=None,
            min_rms=0.003,
            min_silence_duration_ms=300,
            on_segment=lambda current, confidence: partials.append(
                (
                    normalize_transcript(" ".join(segment.text for segment in current)),
                    confidence,
                )
            ),
        )

        self.assertEqual(len(segments), 2)
        self.assertEqual(partials[0][0], "I need to")
        self.assertEqual(partials[-1][0], "I need to verify your bank account immediately")
        self.assertEqual(len(partials), 2)

    def test_stitching_keeps_words_across_chunk_boundary_and_deduplicates_overlap(self):
        stitched = stitch_transcripts(
            "Please transfer the account",
            "the account number today.",
        )

        self.assertEqual(stitched, "Please transfer the account number today.")

    def test_repeated_tokens_and_whitespace_are_normalized(self):
        self.assertEqual(normalize_transcript("  Hello   there \n"), "Hello there")
        self.assertEqual(
            stitch_transcripts("I need help now", "help now please"),
            "I need help now please",
        )

    def test_quiet_audio_does_not_pass_energy_gate(self):
        self.assertFalse(
            has_speech_energy(np.tile([0.001, -0.001], 20), min_rms=0.003)
        )
        self.assertTrue(
            has_speech_energy(np.tile([0.01, -0.01], 20), min_rms=0.003)
        )

    def test_english_call_language_and_scam_terms(self):
        original = "Your HDFC account is block. Share the one time password for verfication."
        normalized, language, confidence = normalize_and_detect_language(original)

        self.assertEqual(language, "english")
        self.assertGreater(confidence, 0.0)
        self.assertEqual(
            normalized,
            "Your HDFC account blocked. Share the OTP for verification.",
        )

    def test_hindi_only_is_preserved_without_translation(self):
        original = "आपका खाता बंद है, कृपया ओटीपी बताइए।"
        normalized, language, _confidence = normalize_and_detect_language(original)

        self.assertEqual(language, "hindi")
        self.assertEqual(normalized, "आपका खाता बंद है, कृपया OTP बताइए।")
        self.assertIn("खाता बंद है", normalized)

    def test_hinglish_call_preserves_code_switching_and_normalizes_vocabulary(self):
        original = "Aapka HDFC account block ho gaya hai, teen OTP do baar verification ke liye"
        normalized, language, confidence = normalize_and_detect_language(original)

        self.assertEqual(language, "hinglish")
        self.assertGreater(confidence, 0.0)
        self.assertEqual(
            normalized,
            "Aapka HDFC account blocked ho gaya hai, 3 OTP 2 baar verification ke liye",
        )
        self.assertIn("Aapka", normalized)
        self.assertIn("ho gaya hai", normalized)
        self.assertIn("verification ke liye", normalized)

    def test_hindi_number_words_and_proper_noun_variants(self):
        self.assertEqual(
            normalize_hinglish_transcript(
                "तीन ओटीपी एसबीआई खाते के लिए",
                language="hindi",
            ),
            "3 OTP SBI खाते के लिए",
        )
        self.assertEqual(
            normalize_hinglish_transcript("aapka h d f c account", language="hinglish"),
            "aapka HDFC account",
        )

    def test_otp_kyc_bank_claim_is_normalized_for_scoring(self):
        normalized, language, _confidence = normalize_and_detect_language(
            "Sir your SBI account block hai, K Y C verify karo and one time password share"
        )

        self.assertEqual(language, "hinglish")
        self.assertEqual(
            normalized,
            "Sir your SBI account blocked hai, KYC verify karo and OTP share",
        )

    def test_language_detector_distinguishes_script_and_code_switch(self):
        self.assertEqual(detect_transcript_language("कृपया अपना खाता बताइए")[0], "hindi")
        self.assertEqual(
            detect_transcript_language("Aap apna bank account verify karo")[0],
            "hinglish",
        )
        self.assertEqual(
            detect_transcript_language("Please verify the bank account")[0],
            "english",
        )

    def test_asr_prompt_contains_local_domain_hints_and_keeps_context(self):
        prompt = get_hinglish_asr_prompt("Aapka account blocked hai")
        self.assertIn("OTP", prompt)
        self.assertIn("HDFC", prompt)
        self.assertIn("Aapka account blocked hai", prompt)

    def test_local_stt_preserves_original_and_emits_normalized_partial_metadata(self):
        sanitizer = LocalSTTSanitizer.__new__(LocalSTTSanitizer)
        sanitizer.model = FakeWhisperModel(
            [
                SimpleNamespace(
                    text="Aapka HDFC account block",
                    avg_logprob=-0.1,
                    no_speech_prob=0.02,
                ),
                SimpleNamespace(
                    text=" ho gaya hai, teen OTP do baar",
                    avg_logprob=-0.1,
                    no_speech_prob=0.02,
                ),
            ]
        )
        sanitizer.beam_size = 5
        sanitizer.language = None
        sanitizer.min_rms = 0.003
        sanitizer.min_silence_duration_ms = 300
        sanitizer._transcript_sessions = OrderedDict()
        sanitizer._session_lock = threading.Lock()
        sanitizer._max_transcript_sessions = 256
        sanitizer.device = "cpu"
        sanitizer.model_size = "large-v3"
        sanitizer._sanitize_transcript = lambda text: text
        partials = []
        finals = []

        with patch(
            "app.services.local_stt.preprocess_audio",
            return_value=np.full(80, 0.1, dtype=np.float32),
        ):
            result = sanitizer.process_audio(
                "in-memory-test.wav",
                on_partial_transcript=lambda *values: partials.append(values),
                on_final_transcript=lambda *values: finals.append(values),
            )

        self.assertEqual(
            result["original_transcript"],
            "Aapka HDFC account block ho gaya hai, teen OTP do baar",
        )
        self.assertEqual(
            result["normalized_transcript"],
            "Aapka HDFC account blocked ho gaya hai, 3 OTP 2 baar",
        )
        self.assertEqual(len(partials), 1)
        self.assertEqual(partials[0][3], "hinglish")
        self.assertGreater(partials[0][4], 0.0)
        self.assertEqual(partials[0][0], "Aapka HDFC account blocked")
        self.assertEqual(len(finals), 1)
        self.assertEqual(finals[0][0], result["final_transcript"])
        self.assertIn("OTP", finals[0][0])
        self.assertGreater(result["time_to_final_stitched_sec"], 0.0)


if __name__ == "__main__":
    unittest.main()
