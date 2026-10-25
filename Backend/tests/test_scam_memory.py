import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock

root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from app.services.scam_memory_service import (
    ScamMemoryService,
    _safe_source_url,
    normalize_claim,
)


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    def __init__(self, db, table):
        self.db = db
        self.table = table
        self.operation = "select"
        self.payload = None
        self.filters = {}

    def upsert(self, payload, on_conflict=None):
        self.operation = "upsert"
        self.payload = dict(payload)
        self.on_conflict = on_conflict
        return self

    def update(self, payload):
        self.operation = "update"
        self.payload = dict(payload)
        return self

    def select(self, _columns):
        return self

    def eq(self, key, value):
        self.filters[key] = value
        return self

    def execute(self):
        rows = self.db.rows.setdefault(self.table, [])
        if self.operation == "upsert":
            existing = next(
                (row for row in rows if row.get(self.on_conflict) == self.payload[self.on_conflict]),
                None,
            )
            if existing:
                existing.update(self.payload)
                existing["occurrence_count"] += 1
                row = existing
            else:
                row = dict(self.payload)
                row.update({
                    "id": str(len(rows) + 1),
                    "first_seen_at": self.payload["last_seen_at"],
                    "created_at": self.payload["last_seen_at"],
                    "updated_at": self.payload["last_seen_at"],
                })
                rows.append(row)
            return FakeResponse([dict(row)])
        matches = [row for row in rows if all(row.get(k) == v for k, v in self.filters.items())]
        if self.operation == "update":
            for row in matches:
                row.update(self.payload)
            return FakeResponse([dict(row) for row in matches])
        return FakeResponse([dict(row) for row in matches])


class FakeDatabase:
    def __init__(self):
        self.rows = {}
        self.rpc_responses = {}
        self.rpc_calls = []

    def table(self, table):
        return FakeQuery(self, table)

    def rpc(self, name, arguments):
        self.rpc_calls.append((name, arguments))
        return Mock(execute=Mock(return_value=FakeResponse(self.rpc_responses.get(name, []))))


class FakeEmbedder:
    model_name = "test-local-model"
    _DEFAULT_VECTOR = object()

    def __init__(self, vector=_DEFAULT_VECTOR):
        self.vector = [0.0] * 384 if vector is self._DEFAULT_VECTOR else vector
        self.inputs = []

    def encode(self, text):
        self.inputs.append(text)
        return self.vector


class ScamMemoryTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self.embedder = FakeEmbedder()
        self.service = ScamMemoryService(self.db, self.embedder)
        self.pattern = {
            "summary": "Impersonates a bank and demands a one-time code.",
            "normalized_text": "bank account suspension threat used to request an otp",
            "scam_type": "bank_otp",
            "tactics": ["urgency", "account suspension threat"],
            "phrases": ["share verification code"],
            "impersonated_orgs": ["bank"],
            "risk_indicators": ["requests secret code"],
        }
        self.evidence = {
            "verdict": "CONTRADICTED",
            "confidence": 0.91,
            "sources": [{"url": "https://rbi.org.in/advisory?token=private#section"}],
        }

    def test_dedupe_increments_occurrence_and_refreshes_seen_time(self):
        first = self.service.ingest_verified_pattern(self.pattern, self.evidence)
        second = self.service.ingest_verified_pattern(self.pattern, self.evidence)

        self.assertEqual(first["canonical_key"], second["canonical_key"])
        self.assertEqual(len(self.db.rows["scam_pattern_memory"]), 1)
        self.assertEqual(second["occurrence_count"], 2)
        self.assertEqual(second["verification_status"], "verified")

    def test_only_verified_patterns_can_be_ingested(self):
        bad_evidence = {**self.evidence, "verdict": "UNCLEAR"}
        with self.assertRaises(ValueError):
            self.service.ingest_verified_pattern(self.pattern, bad_evidence)
        self.assertNotIn("scam_pattern_memory", self.db.rows)

    def test_verification_requires_valid_evidence_and_stale_mark_deactivates_pattern(self):
        row = self.service.ingest_verified_pattern(self.pattern, self.evidence)
        self.db.rows["scam_pattern_memory"][0]["verification_status"] = "candidate"
        verified = self.service.mark_pattern_verified(row["canonical_key"], self.evidence)
        stale = self.service.mark_pattern_stale(row["canonical_key"])

        self.assertEqual(verified["verification_status"], "verified")
        self.assertFalse(stale["active"])
        self.assertLessEqual(
            datetime.fromisoformat(stale["expires_at"]),
            datetime.now(timezone.utc),
        )

    def test_retrieval_excludes_unverified_and_stale_rows(self):
        now = datetime.now(timezone.utc)
        rows = [
            {
                "canonical_key": "verified",
                "verification_status": "verified",
                "active": True,
                "last_verified_at": now.isoformat(),
                "expires_at": (now + timedelta(days=1)).isoformat(),
            },
            {
                "canonical_key": "candidate",
                "verification_status": "candidate",
                "active": True,
                "last_verified_at": now.isoformat(),
            },
            {
                "canonical_key": "stale",
                "verification_status": "verified",
                "active": True,
                "last_verified_at": (now - timedelta(days=181)).isoformat(),
            },
            {
                "canonical_key": "inactive",
                "verification_status": "verified",
                "active": False,
                "last_verified_at": now.isoformat(),
            },
        ]
        self.db.rpc_responses["match_scam_pattern_memory"] = rows
        self.db.rpc_responses["search_scam_pattern_memory_keyword"] = rows

        hits = self.service.retrieve_patterns("account suspension", top_k=5)

        self.assertEqual([hit["canonical_key"] for hit in hits], ["verified"])

    def test_semantic_retrieval_uses_the_configured_local_model(self):
        now = datetime.now(timezone.utc)
        self.db.rpc_responses["match_scam_pattern_memory"] = [{
            "canonical_key": "semantic",
            "verification_status": "verified",
            "active": True,
            "last_verified_at": now.isoformat(),
            "expires_at": (now + timedelta(days=1)).isoformat(),
        }]

        hits = self.service.retrieve_patterns("bank account suspension", top_k=1)

        self.assertEqual([hit["retrieval_method"] for hit in hits], ["semantic"])
        call_name, arguments = self.db.rpc_calls[0]
        self.assertEqual(call_name, "match_scam_pattern_memory")
        self.assertEqual(arguments["query_embedding_model"], self.embedder.model_name)
        self.assertEqual(len(arguments["query_embedding"].strip("[]").split(",")), 384)

    def test_lexical_fallback_runs_when_embedding_is_unavailable(self):
        service = ScamMemoryService(self.db, FakeEmbedder(vector=None))
        now = datetime.now(timezone.utc)
        self.db.rpc_responses["search_scam_pattern_memory_keyword"] = [{
            "canonical_key": "lexical",
            "verification_status": "verified",
            "active": True,
            "last_verified_at": now.isoformat(),
            "expires_at": (now + timedelta(days=1)).isoformat(),
        }]

        hits = service.retrieve_patterns("bank account suspension", top_k=3)

        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["retrieval_method"], "lexical")
        self.assertEqual(
            [call[0] for call in self.db.rpc_calls],
            ["search_scam_pattern_memory_keyword"],
        )

    def test_memory_write_redacts_sensitive_values_and_rejects_raw_transcript_field(self):
        pattern_with_secret = {
            **self.pattern,
            "summary": "John Smith says the account will be suspended.",
            "normalized_text": "share OTP 123456 for account 1234 5678 9012",
            "phrases": ["call me at +91 98765 43210"],
        }
        stored = self.service.ingest_verified_pattern(pattern_with_secret, self.evidence)
        serialized = str(stored)

        for secret in (
            "John Smith",
            "123456",
            "1234 5678 9012",
            "+91 98765 43210",
            "token=private",
            "#section",
        ):
            self.assertNotIn(secret, serialized)

        with self.assertRaises(ValueError):
            self.service.ingest_verified_pattern(
                {**self.pattern, "transcript": "raw call dialogue"},
                self.evidence,
            )

    def test_source_urls_drop_query_and_fragment(self):
        self.assertEqual(
            _safe_source_url("https://example.org/advisory?account=123#private"),
            "https://example.org/advisory",
        )
        self.assertIsNone(_safe_source_url("http://example.org/advisory"))

    def test_normalization_removes_secrets_before_embedding(self):
        normalized = normalize_claim("Share OTP 123456 at https://example.org/path?token=secret")
        self.assertNotIn("123456", normalized)
        self.assertNotIn("token=secret", normalized)
        self.assertIn("[redacted_secret]", normalized)


if __name__ == "__main__":
    unittest.main()
