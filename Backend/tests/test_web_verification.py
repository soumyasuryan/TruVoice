import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from app.config import settings
from app.services.web_verification_service import (
    CallVerificationSession,
    compute_web_verification_risk,
    detect_claims_and_questions,
    global_verification_cache,
    judge_claim_with_llm,
    normalize_question,
    scrub_pii,
    verify_claim_pipeline,
    TinyFishClient,
)


class TestWebVerificationLayer(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        global_verification_cache.clear()

    def test_risk_never_going_down(self):
        # 1. Starting at MODERATE (65.0)
        risk = compute_web_verification_risk(base_score=65.0, base_level="MODERATE", contradicted_count=0)
        self.assertEqual(risk["final_score"], 65.0)
        self.assertEqual(risk["final_level"], "MODERATE")

        # 2. Starting at SEVERE (92.0)
        risk_severe = compute_web_verification_risk(base_score=92.0, base_level="SEVERE", contradicted_count=1)
        self.assertGreaterEqual(risk_severe["final_score"], 92.0)
        self.assertEqual(risk_severe["final_level"], "SEVERE")

    def test_supported_and_unclear_changing_nothing(self):
        # When claims are supported or unclear, contradicted_count is 0
        risk = compute_web_verification_risk(
            base_score=20.0,
            base_level="SAFE",
            contradicted_count=0,
            reasons=["Guidance supports the procedure"],
        )
        self.assertEqual(risk["web_boost"], 0.0)
        self.assertEqual(risk["final_score"], 20.0)
        self.assertEqual(risk["final_level"], "SAFE")

    def test_one_contradicted_claim_raising_at_least_moderate(self):
        # Base SAFE (15.0) -> raised to at least MODERATE (>= 60.0)
        risk = compute_web_verification_risk(
            base_score=15.0,
            base_level="SAFE",
            contradicted_count=1,
            reasons=["RBI states banks never ask for OTP"],
        )
        self.assertEqual(risk["final_level"], "MODERATE")
        self.assertGreaterEqual(risk["final_score"], 60.0)
        self.assertGreater(risk["web_boost"], 0.0)

        # Base MODERATE (65.0) -> stays at least MODERATE
        risk_mod = compute_web_verification_risk(
            base_score=65.0,
            base_level="MODERATE",
            contradicted_count=1,
        )
        self.assertEqual(risk_mod["final_level"], "MODERATE")
        self.assertGreaterEqual(risk_mod["final_score"], 65.0)

    def test_two_different_contradicted_claims_raising_severe(self):
        # Two contradicted claims raise to SEVERE (>= 85.0)
        risk = compute_web_verification_risk(
            base_score=15.0,
            base_level="SAFE",
            contradicted_count=2,
            reasons=["Contradicted: OTP request", "Contradicted: AnyDesk installation"],
        )
        self.assertEqual(risk["final_level"], "SEVERE")
        self.assertGreaterEqual(risk["final_score"], 85.0)

    async def test_personal_data_never_leaving_backend(self):
        pii_transcript = (
            "Hello John Doe from victim@gmail.com phone +91 9876543210 "
            "card 4111 2222 3333 4444 click https://bad-phish.com/hack "
            "your account will be blocked unless you share the OTP"
        )
        scrubbed = scrub_pii(pii_transcript)
        self.assertNotIn("victim@gmail.com", scrubbed)
        self.assertNotIn("+91 9876543210", scrubbed)
        self.assertNotIn("4111 2222 3333 4444", scrubbed)
        self.assertNotIn("https://bad-phish.com/hack", scrubbed)

        # Verify through pipeline
        recorded_queries = []

        class MockTinyFishClient(TinyFishClient):
            async def search(self, query: str):
                recorded_queries.append(query)
                return []

            async def fetch(self, urls: list[str]):
                return []

        mock_client = MockTinyFishClient()
        detected = detect_claims_and_questions(pii_transcript)
        self.assertTrue(len(detected) > 0)

        # Run pipeline with await
        await verify_claim_pipeline(
            call_id="call-pii-test",
            claim_id=detected[0]["claim_id"],
            claim_text=detected[0]["claim_text"],
            question=detected[0]["question"],
            client=mock_client,
        )

        for query in recorded_queries:
            self.assertNotIn("victim@gmail.com", query)
            self.assertNotIn("+91 9876543210", query)
            self.assertNotIn("4111 2222 3333 4444", query)
            self.assertNotIn("https://bad-phish.com", query)

    async def test_failures_adding_no_risk(self):
        # If TinyFish fails completely
        class FailingTinyFishClient(TinyFishClient):
            async def search(self, query: str):
                raise RuntimeError("TinyFish connection timeout")

            async def fetch(self, urls: list[str]):
                raise RuntimeError("TinyFish fetch error")

        mock_client = FailingTinyFishClient()
        result = await verify_claim_pipeline(
            call_id="call-fail-test",
            claim_id="bank_otp",
            claim_text="share the OTP",
            question="Do banks ask for OTP?",
            client=mock_client,
        )
        self.assertEqual(result["verdict"], "UNCLEAR")
        # Failures add no risk
        risk = compute_web_verification_risk(
            base_score=25.0,
            base_level="SAFE",
            contradicted_count=0 if result["verdict"] != "CONTRADICTED" else 1,
        )
        self.assertEqual(risk["web_boost"], 0.0)
        self.assertEqual(risk["final_score"], 25.0)
        self.assertEqual(risk["final_level"], "SAFE")

    def test_all_sample_claims_detected(self):
        samples = [
            ("I am calling from your bank to verify your details", "bank_impersonation"),
            ("Your account will be blocked unless you share the OTP now", "bank_otp"),
            ("Please install AnyDesk remote access right now", "remote_access"),
            ("You must pay a clearance charge fee to receive your parcel", "fee_or_fine"),
            ("Please share your card CVV and ATM PIN for security", "credentials_cvv"),
        ]
        for sentence, expected_id in samples:
            detected = detect_claims_and_questions(sentence)
            detected_ids = [d["claim_id"] for d in detected]
            self.assertIn(expected_id, detected_ids, f"Failed to detect {expected_id} in '{sentence}'")

    async def test_cache_reuse_marked_as_cached(self):
        class MockSearchClient(TinyFishClient):
            search_calls = 0

            async def search(self, query: str):
                self.search_calls += 1
                return [{
                    "title": "RBI Advisory on OTP Scam",
                    "url": "https://rbi.org.in/advisory",
                    "snippet": "RBI warns that banks never ask for OTP or passwords.",
                }]

            async def fetch(self, urls: list[str]):
                return [{
                    "url": "https://rbi.org.in/advisory",
                    "title": "RBI Advisory",
                    "text": "RBI explicitly clarifies banks never ask customers to share OTP over the phone.",
                }]

        client = MockSearchClient()
        question = "Do banks ask customers to share OTP over the phone to prevent account blocking?"

        # First check -> origin "tinyfish"
        res1 = await verify_claim_pipeline(
            call_id="call-1",
            claim_id="bank_otp",
            claim_text="share the OTP",
            question=question,
            client=client,
        )
        self.assertEqual(res1["origin"], "tinyfish")
        self.assertEqual(res1["verdict"], "CONTRADICTED")
        self.assertEqual(client.search_calls, 1)

        # Second check -> origin "cache"
        res2 = await verify_claim_pipeline(
            call_id="call-2",
            claim_id="bank_otp",
            claim_text="share the OTP",
            question=question,
            client=client,
        )
        self.assertEqual(res2["origin"], "cache")
        self.assertEqual(res2["verdict"], "CONTRADICTED")
        # Search API should not be called again
        self.assertEqual(client.search_calls, 1)

    def test_session_rate_limits_and_severe_skip(self):
        session = CallVerificationSession("call-limit-test")
        self.assertTrue(session.should_verify("SAFE"))

        # When call is severe and VERIFY_WHEN_SEVERE is false, skip
        with patch.object(settings, "VERIFY_WHEN_SEVERE", False):
            self.assertFalse(session.should_verify("SEVERE"))

        # When VERIFY_WHEN_SEVERE is true, do not skip
        with patch.object(settings, "VERIFY_WHEN_SEVERE", True):
            self.assertTrue(session.should_verify("SEVERE"))

        # Rate limit gap (CLAIM_MIN_GAP_S)
        session.record_check_started("claim-1")
        self.assertFalse(session.should_verify("SAFE"))

        # Claim count limit (CLAIM_MAX_PER_CALL)
        session.claims_checked_count = settings.CLAIM_MAX_PER_CALL
        session.last_check_time = 0.0
        self.assertFalse(session.should_verify("SAFE"))


if __name__ == "__main__":
    unittest.main()
