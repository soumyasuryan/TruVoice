import asyncio
import base64
import unittest
from unittest.mock import patch

from app.routers import analysis
from app.schemas import AudioBase64Request


class FakeLivePipeline:
    def analyze_audio_sample(
        self,
        _audio_path,
        call_id,
        on_partial_transcript,
        on_final_transcript,
    ):
        on_partial_transcript("Your SBI account", 0.71, "medium", "english", 0.8, 0.1)
        on_final_transcript(
            "Your SBI account is blocked",
            0.88,
            "high",
            "english",
            0.9,
            0.25,
        )
        return {
            "file_name": "chunk.wav",
            "transcript": "Your SBI account is blocked",
            "partial_transcript": "",
            "final_transcript": "Your SBI account is blocked",
            "normalized_transcript": "Your SBI account is blocked",
            "transcript_confidence": 0.88,
            "transcript_quality": "high",
            "transcript_language": "english",
            "transcript_language_confidence": 0.9,
            "time_to_first_partial_sec": 0.1,
            "time_to_final_stitched_sec": 0.25,
            "time_to_first_score_sec": 0.4,
            "ai_voice_probability": 10.0,
            "scam_intent_score": 30.0,
            "unified_risk_score": 25.0,
            "trust_score": 75.0,
            "risk_level": "SAFE",
            "threat_type": "NORMAL",
            "ui_alert": "This call looks safe.",
            "scam_category": "Safe Call",
            "flagged_keywords": [],
            "reasoning": "Test result.",
        }


class AnalysisTranscriptionFlowTests(unittest.TestCase):
    def test_live_route_emits_partial_then_final_then_score(self):
        emitted_events = []
        broadcast_events = []

        async def emit_event(_call_id, event_type, _payload):
            emitted_events.append(event_type)

        async def broadcast(_call_id, payload):
            broadcast_events.append(payload)

        payload = AudioBase64Request(
            audio_base64=base64.b64encode(b"wav test").decode("ascii"),
            call_id="transcription-flow-test",
        )

        async def run_route():
            with (
                patch.object(analysis, "get_pipeline", return_value=FakeLivePipeline()),
                patch.object(analysis, "_save_analysis_history"),
                patch.object(analysis, "_update_voice_call_record"),
                patch.object(analysis.manager, "emit_call_event", side_effect=emit_event),
                patch.object(analysis.manager, "broadcast_to_call", side_effect=broadcast),
            ):
                result = await analysis.analyze_base64_audio(
                    payload,
                    user_id="test-user",
                )
                await asyncio.sleep(0)
                return result

        result = asyncio.run(run_route())

        self.assertEqual(emitted_events, ["transcript_partial", "transcript_final"])
        self.assertEqual(len(broadcast_events), 1)
        self.assertEqual(broadcast_events[0]["type"], "analysis_update")
        self.assertEqual(
            broadcast_events[0]["final_transcript"],
            "Your SBI account is blocked",
        )
        self.assertEqual(
            result["final_transcript"],
            "Your SBI account is blocked",
        )


if __name__ == "__main__":
    unittest.main()
