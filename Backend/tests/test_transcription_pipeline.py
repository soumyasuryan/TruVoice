import unittest

from app.utils.pipeline import UnifiedPipelineTester


class FakeVoiceDetector:
    def predict(self, _audio_path):
        return {"spoof_probability": 0.1}


class FakeLocalSTT:
    def __init__(self):
        self.callbacks = None

    def process_audio(
        self,
        _audio_path,
        *,
        call_id,
        on_partial_transcript,
        on_final_transcript,
    ):
        self.callbacks = (call_id, on_partial_transcript, on_final_transcript)
        return {
            "sanitized_transcript": "Please verify the account.",
            "stitched_transcript": "Please verify the account.",
            "final_transcript": "Please verify the account.",
            "raw_transcript": "Please verify the account.",
            "transcript_confidence": 0.62,
            "transcript_quality": "medium",
            "transcript_language": "english",
            "transcript_language_confidence": 0.8,
            "stt_latency_sec": 0.4,
            "time_to_first_partial_sec": 0.12,
            "time_to_final_stitched_sec": 0.35,
        }


class FakeScamDetector:
    def __init__(self):
        self.calls = []

    def analyze_scam_intent(self, transcript, transcript_confidence):
        self.calls.append((transcript, transcript_confidence))
        return {
            "scam_score": 0.3,
            "category": "Safe Call",
            "risk_keywords": [],
            "reasoning": "Test result.",
        }


class TranscriptionPipelineTests(unittest.TestCase):
    def test_pipeline_scores_final_text_with_transcript_confidence(self):
        pipeline = UnifiedPipelineTester.__new__(UnifiedPipelineTester)
        pipeline.voice_detector = FakeVoiceDetector()
        pipeline.local_stt = FakeLocalSTT()
        pipeline.scam_detector = FakeScamDetector()
        partial_callback = lambda *_values: None
        final_callback = lambda *_values: None

        result = pipeline.analyze_audio_sample(
            "call.wav",
            call_id="call-1",
            on_partial_transcript=partial_callback,
            on_final_transcript=final_callback,
        )

        self.assertEqual(
            pipeline.scam_detector.calls,
            [("Please verify the account.", 0.62)],
        )
        self.assertEqual(
            pipeline.local_stt.callbacks,
            ("call-1", partial_callback, final_callback),
        )
        self.assertEqual(result["final_transcript"], "Please verify the account.")
        self.assertEqual(result["transcript_confidence"], 0.62)
        self.assertGreaterEqual(result["time_to_first_score_sec"], 0.0)
        self.assertEqual(result["time_to_first_partial_sec"], 0.12)


if __name__ == "__main__":
    unittest.main()
