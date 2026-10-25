import sys
import unittest
from pathlib import Path
from unittest.mock import patch

root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from app.services.autonomous_memory_scanner import AutonomousMemoryScanner


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeDatabase:
    def __init__(self):
        self.calls = []

    def rpc(self, name, arguments):
        self.calls.append((name, arguments))
        return self

    def execute(self):
        return FakeResponse(True)


class FakeTinyFish:
    def __init__(self):
        self.fetched_urls = []
        self.search_count = 0

    async def search(self, _query):
        self.search_count += 1
        return [
            {
                "url": "https://untrusted.example/scam-news",
                "title": "Untrusted search result",
            },
            *[
                {
                    "url": f"https://rbi.org.in/advisory-{self.search_count}-{index}",
                    "title": f"Official advisory {index}",
                }
                for index in range(2)
            ],
        ]

    async def fetch(self, urls):
        self.fetched_urls = urls
        return [
            {
                "url": url,
                "title": "Official advisory",
                "text": (
                    "Official advisory: fraudsters ask customers to share "
                    "one-time passwords to prevent account blocking."
                ),
            }
            for url in urls
        ]


class FakeMemoryService:
    def __init__(self):
        self.persisted = []

    def ingest_verified_pattern(self, pattern, evidence):
        self.persisted.append((pattern, evidence))
        return {"canonical_key": "test"}


class AutonomousMemoryScannerTests(unittest.IsolatedAsyncioTestCase):
    def candidate(self, **overrides):
        candidate = {
            "scam_type": "bank_otp",
            "summary": "Caller asks customers to share an OTP to avoid account blocking",
            "normalized_text": "caller asks customers to share otp to avoid account blocking",
            "tactics": ["urgency"],
            "phrases": [],
            "impersonated_orgs": ["bank"],
            "risk_indicators": ["otp request"],
            "confidence": 0.91,
            "source_index": 0,
            "evidence_quote": (
                "fraudsters ask customers to share one-time passwords to prevent account blocking."
            ),
        }
        candidate.update(overrides)
        return candidate

    async def test_scan_filters_official_sources_and_persists_quoted_evidence(self):
        database = FakeDatabase()
        tinyfish = FakeTinyFish()
        memory = FakeMemoryService()
        scanner = AutonomousMemoryScanner(tinyfish, memory)

        async def extract(_pages):
            return [self.candidate()]

        scanner._extract_patterns = extract
        settings = patch.multiple(
            "app.services.autonomous_memory_scanner.settings",
            AUTONOMOUS_MEMORY_ENABLED=True,
            TINYFISH_ENABLED=True,
            TINYFISH_API_KEY="configured",
            GROQ_API_KEY="configured",
            OFFICIAL_DOMAINS="rbi.org.in",
            AUTONOMOUS_MEMORY_INTERVAL_SECONDS=3600,
        )
        with settings, patch(
            "app.services.autonomous_memory_scanner.get_supabase",
            return_value=database,
        ):
            result = await scanner.run_once()

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["pages_fetched"], 3)
        self.assertEqual(result["candidates_found"], 1)
        self.assertEqual(result["patterns_stored"], 1)
        self.assertEqual(len(memory.persisted), 1)
        pattern, evidence = memory.persisted[0]
        self.assertEqual(pattern["scam_type"], "bank_otp")
        self.assertEqual(evidence["verdict"], "CONTRADICTED")
        self.assertEqual(len(tinyfish.fetched_urls), 3)
        self.assertFalse(any("untrusted" in url for url in tinyfish.fetched_urls))
        self.assertEqual(database.calls[0][0], "claim_autonomous_memory_scan")
        self.assertEqual(database.calls[1][0], "record_autonomous_memory_scan")

    def test_candidate_requires_official_page_and_verbatim_quote(self):
        allowed_domains = {"rbi.org.in"}
        pages = [{
            "url": "https://rbi.org.in/advisory",
            "title": "Official",
            "text": "This official advisory warns customers about a reported fraud pattern.",
        }]

        self.assertIsNone(AutonomousMemoryScanner._validate_candidate(
            self.candidate(evidence_quote="This sentence does not occur in the page text."),
            pages,
            allowed_domains,
        ))
        self.assertIsNone(AutonomousMemoryScanner._validate_candidate(
            self.candidate(evidence_quote="This official advisory explains routine account security practices."),
            pages,
            allowed_domains,
        ))
        self.assertIsNone(AutonomousMemoryScanner._validate_candidate(
            self.candidate(),
            [{**pages[0], "url": "https://untrusted.example/advisory"}],
            allowed_domains,
        ))
        self.assertIsNone(AutonomousMemoryScanner._validate_candidate(
            self.candidate(tactics="not a list"),
            pages,
            allowed_domains,
        ))


if __name__ == "__main__":
    unittest.main()
