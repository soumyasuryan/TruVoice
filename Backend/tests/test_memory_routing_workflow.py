import asyncio
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from app.services.memory_routing_workflow import MemoryRoutingWorkflow
from app.services.web_verification_service import settings


def verified_hit(similarity=0.95):
    now = datetime.now(timezone.utc)
    return {
        "canonical_key": "verified-bank-otp",
        "scam_type": "bank_otp",
        "verification_status": "verified",
        "active": True,
        "confidence": 0.94,
        "similarity": similarity,
        "last_verified_at": now.isoformat(),
        "expires_at": (now + timedelta(days=30)).isoformat(),
        "impersonated_orgs": ["bank"],
    }


class FakeMemoryService:
    def __init__(self, hits=None, error=None):
        self.hits = hits or []
        self.error = error
        self.persisted = []

    def retrieve_patterns(self, claim, top_k):
        if self.error:
            raise self.error
        return self.hits[:top_k]

    def ingest_verified_pattern(self, pattern, evidence):
        self.persisted.append((pattern, evidence))
        return {"canonical_key": "persisted"}


class MemoryRoutingWorkflowTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.events = []

    async def emit(self, call_id, event, payload):
        self.events.append((call_id, event, payload))

    async def test_known_pattern_reuses_memory_without_tinyfish(self):
        hit = verified_hit()
        hit["source_urls"] = ["https://bank.example/guide?token=private"]
        memory = FakeMemoryService([hit])

        async def never_verify(**_kwargs):
            self.fail("Known verified memory must not trigger TinyFish")

        workflow = MemoryRoutingWorkflow(memory, never_verify, self.emit)
        result = await workflow.process_claim(
            call_id="call-known",
            claim="Your account will be blocked unless you share the OTP",
            claim_type="bank_otp",
            entity="bank",
            question="Do banks ask for OTP?",
            base_score=20,
            base_level="SAFE",
        )

        self.assertEqual(result["route"], "reuse")
        self.assertEqual(result["status"], "verified_memory_reused")
        self.assertGreaterEqual(result["final_score"], 60)
        self.assertIn(("call-known", "memory_update", unittest.mock.ANY), self.events)
        memory_event = next(payload for _, event, payload in self.events if event == "memory_update")
        self.assertEqual(memory_event["sources"], [
            {"title": "bank.example", "url": "https://bank.example"}
        ])
        self.assertNotIn("private", str(memory_event))
        self.assertTrue(any(event == "risk_update" for _, event, _ in self.events))

    async def test_exact_verified_lexical_match_reuses_without_tinyfish(self):
        claim = "Your account will be blocked unless you share the OTP"
        hit = verified_hit()
        hit.pop("similarity")
        hit["retrieval_method"] = "lexical"
        hit["normalized_text"] = claim.casefold()
        memory = FakeMemoryService([hit])

        async def never_verify(**_kwargs):
            self.fail("An exact verified lexical match must not trigger TinyFish")

        workflow = MemoryRoutingWorkflow(memory, never_verify, self.emit)
        result = await workflow.process_claim(
            call_id="call-lexical-known",
            claim=claim,
            claim_type="bank_otp",
            base_score=10,
            base_level="SAFE",
        )

        self.assertEqual(result["route"], "reuse")
        self.assertEqual(result["status"], "verified_memory_reused")

    async def test_new_claim_routes_to_tinyfish_and_persists_validated_evidence(self):
        memory = FakeMemoryService()
        verify_calls = []

        async def verify(**kwargs):
            verify_calls.append(kwargs)
            return {
                "verdict": "CONTRADICTED",
                "confidence": 0.93,
                "sources": [{"url": "https://rbi.org.in/advisory?private=1"}],
            }

        workflow = MemoryRoutingWorkflow(memory, verify, self.emit)
        result = await workflow.process_claim(
            call_id="call-new",
            claim="Install remote access software to resolve the account issue",
            claim_type="remote_access",
            base_score=15,
            base_level="SAFE",
        )
        pending = tuple(workflow._persistence_tasks)
        if pending:
            await asyncio.gather(*pending)

        self.assertEqual(result["route"], "verify")
        self.assertEqual(len(verify_calls), 1)
        self.assertEqual(len(memory.persisted), 1)
        self.assertGreaterEqual(result["final_score"], 60)
        self.assertNotIn("private=1", str(memory.persisted))

    async def test_weak_stale_and_conflicting_memory_matches_use_tinyfish(self):
        memory = FakeMemoryService()
        verify_calls = []

        async def verify(**kwargs):
            verify_calls.append(kwargs)
            return {"verdict": "UNCLEAR", "confidence": 0.5, "sources": []}

        workflow = MemoryRoutingWorkflow(memory, verify, self.emit)
        stale = verified_hit()
        stale["last_verified_at"] = (datetime.now(timezone.utc) - timedelta(days=181)).isoformat()
        cases = [
            ("weak", [verified_hit(similarity=0.79)]),
            ("stale", [stale]),
            (
                "conflict",
                [
                    verified_hit(similarity=0.93),
                    {**verified_hit(similarity=0.925), "canonical_key": "another-pattern"},
                ],
            ),
        ]

        for call_id, hits in cases:
            memory.hits = hits
            result = await workflow.process_claim(
                call_id=f"call-{call_id}",
                claim="Your account will be blocked unless you share the OTP",
                claim_type="bank_otp",
                base_score=10,
                base_level="SAFE",
            )
            self.assertEqual(result["route"], "verify")

        self.assertEqual(len(verify_calls), 3)

    async def test_repeated_claim_in_same_call_is_deduplicated(self):
        memory = FakeMemoryService()
        verify_calls = []

        async def verify(**_kwargs):
            verify_calls.append(True)
            return {"verdict": "UNCLEAR", "confidence": 0.5, "sources": []}

        workflow = MemoryRoutingWorkflow(memory, verify, self.emit)
        first = await workflow.process_claim(
            call_id="call-repeat",
            claim="Install remote access software to resolve the account issue",
            claim_type="remote_access",
            base_score=12,
            base_level="SAFE",
        )
        second = await workflow.process_claim(
            call_id="call-repeat",
            claim="Install remote access software to resolve the account issue",
            claim_type="remote_access",
            base_score=20,
            base_level="SAFE",
        )

        self.assertEqual(first["route"], "verify")
        self.assertTrue(second["deduplicated"])
        self.assertEqual(second["status"], "repeated_claim_reused")
        self.assertEqual(len(verify_calls), 1)

    async def test_retrieval_failure_falls_back_and_verification_failure_fails_open(self):
        memory = FakeMemoryService(error=RuntimeError("database unavailable"))

        async def verify(**_kwargs):
            raise RuntimeError("TinyFish unavailable")

        workflow = MemoryRoutingWorkflow(memory, verify, self.emit)
        result = await workflow.process_claim(
            call_id="call-failure",
            claim="Install remote access software",
            claim_type="remote_access",
            base_score=24,
            base_level="SAFE",
        )

        self.assertEqual(result["route"], "verify")
        self.assertEqual(result["status"], "verification_failed_open")
        self.assertEqual(result["final_score"], 24)
        self.assertFalse(any(event == "risk_update" for _, event, _ in self.events))

    async def test_memory_risk_is_monotonic_across_repeated_claims(self):
        memory = FakeMemoryService([verified_hit()])
        workflow = MemoryRoutingWorkflow(memory, emit_function=self.emit)
        first = await workflow.process_claim(
            call_id="call-monotonic",
            claim="Your account will be blocked unless you share the OTP",
            claim_type="bank_otp",
            base_score=20,
            base_level="SAFE",
        )
        second = await workflow.process_claim(
            call_id="call-monotonic",
            claim="Your account will be blocked unless you share the OTP",
            claim_type="bank_otp",
            base_score=5,
            base_level="SAFE",
        )

        self.assertGreaterEqual(first["final_score"], 20)
        self.assertGreaterEqual(second["final_score"], first["final_score"])
        self.assertEqual(first["final_level"], second["final_level"])

    def test_persisted_risk_update_uses_atomic_monotonic_database_rpc(self):
        client = unittest.mock.Mock()
        call_id = str(uuid4())
        with patch(
            "app.services.memory_routing_workflow.get_supabase",
            return_value=client,
        ):
            MemoryRoutingWorkflow._persist_call_risk({
                "call_id": call_id,
                "final_level": "SEVERE",
                "final_score": 90,
            })

        client.rpc.assert_called_once_with(
            "raise_voice_call_risk",
            {
                "p_call_id": call_id,
                "p_risk_level": "SEVERE",
                "p_risk_score": 90,
            },
        )
        client.rpc.return_value.execute.assert_called_once_with()

    async def test_call_verification_budget_skips_tinyfish(self):
        memory = FakeMemoryService()
        verify_calls = []

        async def verify(**_kwargs):
            verify_calls.append(True)
            return {"verdict": "UNCLEAR", "confidence": 0.5, "sources": []}

        workflow = MemoryRoutingWorkflow(memory, verify, self.emit)
        with patch.object(settings, "CLAIM_MAX_PER_CALL", 0):
            result = await workflow.process_claim(
                call_id="call-budget",
                claim="Install remote access software",
                claim_type="remote_access",
                base_score=10,
                base_level="SAFE",
            )

        self.assertEqual(result["route"], "skip")
        self.assertEqual(verify_calls, [])
        with patch.object(settings, "CLAIM_MAX_PER_CALL", 1):
            retried = await workflow.process_claim(
                call_id="call-budget",
                claim="Install remote access software",
                claim_type="remote_access",
                base_score=10,
                base_level="SAFE",
            )
        self.assertEqual(retried["route"], "verify")
        self.assertEqual(len(verify_calls), 1)

    async def test_memory_floor_is_preserved_for_later_distinct_claims(self):
        memory = FakeMemoryService([verified_hit()])

        async def verify(**_kwargs):
            return {"verdict": "UNCLEAR", "confidence": 0.5, "sources": []}

        workflow = MemoryRoutingWorkflow(memory, verify, self.emit)
        first = await workflow.process_claim(
            call_id="call-floor",
            claim="Your account will be blocked unless you share the OTP",
            claim_type="bank_otp",
            base_score=20,
            base_level="SAFE",
        )
        memory.hits = []
        later = await workflow.process_claim(
            call_id="call-floor",
            claim="Install remote access software",
            claim_type="remote_access",
            base_score=5,
            base_level="SAFE",
        )

        self.assertEqual(later["route"], "verify")
        self.assertGreaterEqual(later["final_score"], first["final_score"])
        self.assertEqual(later["final_level"], first["final_level"])


if __name__ == "__main__":
    unittest.main()
