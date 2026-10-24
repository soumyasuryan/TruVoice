import sys
from pathlib import Path

# Add project root directory to sys.path
root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from app.main import app
from app.routers.voice import get_pending_incoming_call
from app.utils.auth import create_access_token
from app.services.agora_service import generate_rtc_token

class TestAgoraVoiceAPI(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.mock_user_id = "test-user-uuid-1234"
        self.auth_token = create_access_token({"sub": self.mock_user_id})

    def test_unauthenticated_voice_token(self):
        response = self.client.post("/api/v1/voice/token", json={"channelName": "channel-123"})
        self.assertEqual(response.status_code, 401)

    def test_authenticated_agora_token(self):
        response = self.client.post(
            "/api/v1/voice/token",
            json={"channelName": "test-channel-alpha"},
            headers={"Authorization": f"Bearer {self.auth_token}"}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("token", data)
        self.assertEqual(data["channelName"], "test-channel-alpha")
        self.assertEqual(data["user_id"], self.mock_user_id)

    def test_agora_token_builder_service(self):
        token = generate_rtc_token("test-channel", self.mock_user_id)
        self.assertTrue(isinstance(token, str))
        self.assertTrue(len(token) > 0)

    def test_root_endpoint(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "online")

    @patch("app.routers.voice.get_supabase")
    def test_stale_pending_call_is_not_returned(self, mock_get_supabase):
        mock_db = Mock()
        stale_time = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        mock_res = Mock()
        mock_res.data = [{
            "id": "call-stale-1",
            "user_id": "other-user",
            "target_user_id": self.mock_user_id,
            "channel_name": "channel-stale",
            "status": "initiated",
            "created_at": stale_time,
        }]
        mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.order.return_value.execute.return_value = mock_res
        mock_get_supabase.return_value = mock_db

        result = get_pending_incoming_call(user_id=self.mock_user_id)

        self.assertEqual(result["has_pending"], False)


    def test_base64_audio_analysis(self):
        import base64
        import struct

        # Build a minimal 16-bit PCM WAV byte buffer
        sample_rate = 16000
        num_channels = 1
        bits_per_sample = 16
        data_len = 3200  # 0.1 sec of audio

        header = struct.pack(
            "<4sI4s4sIHHIIHH4sI",
            b"RIFF",
            36 + data_len,
            b"WAVE",
            b"fmt ",
            16,
            1,
            num_channels,
            sample_rate,
            sample_rate * num_channels * bits_per_sample // 8,
            num_channels * bits_per_sample // 8,
            bits_per_sample,
            b"data",
            data_len,
        )
        audio_payload = header + b"\x00" * data_len
        b64_audio = base64.b64encode(audio_payload).decode("utf-8")

        response = self.client.post(
            "/api/v1/analysis/audio",
            json={
                "audio_base64": b64_audio,
                "caller_number": "+919876543210",
                "call_id": "test-call-id-999",
            },
            headers={"Authorization": f"Bearer {self.auth_token}"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("transcript", data)
        self.assertIn("unified_risk_score", data)
        self.assertIn("risk_level", data)

if __name__ == "__main__":
    unittest.main()
