"""Local-embedding retrieval and verified scam-pattern persistence."""

from __future__ import annotations

import hashlib
import logging
import math
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence
from urllib.parse import urlsplit, urlunsplit

from app.config import settings
from app.database import get_supabase

logger = logging.getLogger(__name__)

EMBEDDING_DIMENSIONS = 384
DEFAULT_TOP_K = 5
MAX_TOP_K = 10
VERIFICATION_MAX_AGE_DAYS = 180
MIN_VERIFICATION_CONFIDENCE = 0.7

_EMAIL_PATTERN = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_PHONE_PATTERN = re.compile(r"(?<!\w)\+?(?:\d[\s().-]*){9,15}(?!\w)")
_LONG_NUMBER_PATTERN = re.compile(r"(?<!\d)(?:\d[ -]?){11,18}\d(?!\d)")
_AADHAAR_PATTERN = re.compile(r"(?<!\d)(?:\d[ -]?){11}\d(?!\d)")
_PAN_PATTERN = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b", re.IGNORECASE)
_OTP_VALUE_PATTERN = re.compile(
    r"(?i)(\b(?:otp|one[\s-]*time[\s-]*password|verification[\s-]*code|passcode)\b"
    r"\D{0,24})\d{4,8}\b"
)
_PASSWORD_VALUE_PATTERN = re.compile(
    r"(?i)(\b(?:password|mpin|pin|cvv)\b\s*(?:is|:|=)\s*)"
    r"['\"]?[A-Za-z0-9!@#$%^&*._-]{3,}['\"]?"
)
_URL_PATTERN = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
_SPACE_PATTERN = re.compile(r"\s+")
_DISALLOWED_KEYS = {
    "audio",
    "caller_number",
    "phone_number",
    "raw_transcript",
    "transcript",
    "transcript_chunk",
}
_PATTERN_KEYS = {
    "summary",
    "normalized_text",
    "scam_type",
    "tactics",
    "phrases",
    "impersonated_orgs",
    "risk_indicators",
}


class _LocalPiiScrubber:
    """Lazily redact named entities with the backend's local Presidio stack."""

    def __init__(self):
        self._lock = threading.Lock()
        self._analyzer = None
        self._anonymizer = None

    def scrub(self, text: str) -> str:
        with self._lock:
            if self._analyzer is None or self._anonymizer is None:
                try:
                    from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer
                    from presidio_analyzer.nlp_engine import NlpEngineProvider
                    from presidio_anonymizer import AnonymizerEngine
                    from presidio_anonymizer.entities import OperatorConfig

                    provider = NlpEngineProvider(nlp_configuration={
                        "nlp_engine_name": "spacy",
                        "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
                    })
                    analyzer = AnalyzerEngine(
                        nlp_engine=provider.create_engine(),
                        supported_languages=["en"],
                    )
                    analyzer.registry.add_recognizer(PatternRecognizer(
                        supported_entity="INDIAN_PAN",
                        name="memory_indian_pan",
                        patterns=[Pattern(
                            name="pan",
                            regex=r"\b[A-Z]{5}\d{4}[A-Z]\b",
                            score=0.9,
                        )],
                    ))
                    analyzer.registry.add_recognizer(PatternRecognizer(
                        supported_entity="AADHAAR",
                        name="memory_aadhaar",
                        patterns=[Pattern(
                            name="aadhaar",
                            regex=r"(?<!\d)(?:\d[ -]?){11}\d(?!\d)",
                            score=0.9,
                        )],
                    ))
                    analyzer.registry.add_recognizer(PatternRecognizer(
                        supported_entity="BANK_ACCOUNT",
                        name="memory_bank_account",
                        patterns=[Pattern(
                            name="account_number",
                            regex=r"(?<!\d)(?:\d[ -]?){5,17}\d(?!\d)",
                            score=0.85,
                        )],
                        context=["account number", "bank account", "a/c number"],
                    ))
                    self._analyzer = analyzer
                    self._anonymizer = AnonymizerEngine()
                    self._operator_config = OperatorConfig(
                        "replace",
                        {"new_value": "[REDACTED_PII]"},
                    )
                except Exception as exc:
                    raise RuntimeError(
                        "Local Presidio PII detection is required before scam memory can be written"
                    ) from exc

            results = self._analyzer.analyze(
                text=text,
                language="en",
                entities=[
                    "PERSON",
                    "PHONE_NUMBER",
                    "EMAIL_ADDRESS",
                    "BANK_ACCOUNT",
                    "CREDIT_CARD",
                    "US_SSN",
                    "UK_NHS",
                    "DATE_OF_BIRTH",
                    "INDIAN_PAN",
                    "AADHAAR",
                ],
            )
            if not results:
                return text
            return self._anonymizer.anonymize(
                text=text,
                analyzer_results=results,
                operators={"DEFAULT": self._operator_config},
            ).text


_local_pii_scrubber = _LocalPiiScrubber()


def _redact_sensitive_text(value: str) -> str:
    """Remove common direct identifiers and secrets before indexing or storage."""
    cleaned = _EMAIL_PATTERN.sub("[REDACTED_EMAIL]", value)
    cleaned = _PAN_PATTERN.sub("[REDACTED_ID]", cleaned)
    cleaned = _AADHAAR_PATTERN.sub("[REDACTED_ID]", cleaned)
    cleaned = _LONG_NUMBER_PATTERN.sub("[REDACTED_NUMBER]", cleaned)
    cleaned = _PHONE_PATTERN.sub("[REDACTED_PHONE]", cleaned)
    cleaned = _OTP_VALUE_PATTERN.sub(r"\1[REDACTED_SECRET]", cleaned)
    cleaned = _PASSWORD_VALUE_PATTERN.sub(r"\1[REDACTED_SECRET]", cleaned)
    cleaned = _URL_PATTERN.sub("[REDACTED_URL]", cleaned)
    cleaned = _local_pii_scrubber.scrub(cleaned)
    return _SPACE_PATTERN.sub(" ", cleaned).strip()


def normalize_claim(claim: str) -> str:
    """Return a privacy-scrubbed, stable, lower-case claim representation."""
    if not isinstance(claim, str):
        raise TypeError("claim must be a string")
    cleaned = _redact_sensitive_text(claim).casefold()
    cleaned = re.sub(r"[^\w\s\[\]]", " ", cleaned)
    return _SPACE_PATTERN.sub(" ", cleaned).strip()


def _clean_text(value: Any, field_name: str, max_length: int = 500) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a string")
    cleaned = _redact_sensitive_text(value)
    if not cleaned:
        raise ValueError(f"{field_name} must not be empty")
    if len(cleaned) > max_length:
        raise ValueError(f"{field_name} exceeds the {max_length}-character limit")
    return cleaned


def _clean_string_list(
    values: Any,
    field_name: str,
    max_items: int = 20,
    max_item_length: int = 160,
) -> list[str]:
    if values is None:
        return []
    if not isinstance(values, (list, tuple)):
        raise ValueError(f"{field_name} must be a list of strings")
    if len(values) > max_items:
        raise ValueError(f"{field_name} cannot contain more than {max_items} items")
    result = []
    for item in values:
        cleaned = _clean_text(item, field_name, max_item_length)
        if cleaned not in result:
            result.append(cleaned)
    return result


def _safe_source_url(value: Any) -> str | None:
    if not isinstance(value, str) or len(value) > 2048:
        return None
    try:
        parsed = urlsplit(value.strip())
        if parsed.scheme.lower() != "https" or not parsed.hostname:
            return None
        if parsed.username or parsed.password:
            return None
        hostname = parsed.hostname.encode("idna").decode("ascii").lower()
        port = parsed.port
        netloc = hostname if port in (None, 443) else f"{hostname}:{port}"
        path = parsed.path[:500]
        if _redact_sensitive_text(path) != path:
            path = ""
        return urlunsplit(("https", netloc, path, "", ""))
    except (UnicodeError, ValueError):
        return None


def _validated_evidence(evidence: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(evidence, Mapping):
        raise ValueError("validated_evidence must be a mapping")
    verdict = str(evidence.get("verdict", "")).upper()
    if verdict != "CONTRADICTED":
        raise ValueError("Only a CONTRADICTED verdict can verify a scam pattern")
    try:
        confidence = float(evidence.get("confidence", 0.0))
    except (TypeError, ValueError) as exc:
        raise ValueError("Evidence confidence must be numeric") from exc
    if not math.isfinite(confidence) or not MIN_VERIFICATION_CONFIDENCE <= confidence <= 1.0:
        raise ValueError(
            f"Evidence confidence must be between {MIN_VERIFICATION_CONFIDENCE} and 1.0"
        )

    raw_sources = evidence.get("sources", [])
    if not isinstance(raw_sources, (list, tuple)):
        raise ValueError("Evidence sources must be a list")
    urls = []
    for source in raw_sources[:10]:
        raw_url = source.get("url") if isinstance(source, Mapping) else source
        safe_url = _safe_source_url(raw_url)
        if safe_url and safe_url not in urls:
            urls.append(safe_url)
    if not urls:
        raise ValueError("At least one valid HTTPS evidence source is required")

    return {
        "confidence": confidence,
        "source_urls": urls,
        "source_domains": sorted({urlsplit(url).hostname or "" for url in urls}),
        "evidence_refs": [{"url": url} for url in urls],
    }


class LocalEmbeddingModel:
    """Lazy local-only Transformer embedder; never downloads a model."""

    def __init__(self, model_path: str | None = None):
        self.model_path = (model_path if model_path is not None else settings.MEMORY_EMBEDDING_MODEL_PATH).strip()
        self.model_name = Path(self.model_path).name if self.model_path else "unconfigured"
        self._model = None
        self._tokenizer = None
        self._lock = threading.Lock()

    def encode(self, text: str) -> list[float] | None:
        if not self.model_path:
            return None
        with self._lock:
            if self._model is None or self._tokenizer is None:
                try:
                    import torch
                    from transformers import AutoModel, AutoTokenizer

                    self._tokenizer = AutoTokenizer.from_pretrained(
                        self.model_path,
                        local_files_only=True,
                    )
                    self._model = AutoModel.from_pretrained(
                        self.model_path,
                        local_files_only=True,
                    )
                    self._model.eval()
                except Exception as exc:
                    self._model = None
                    self._tokenizer = None
                    raise RuntimeError(
                        "Could not load the configured memory embedding model locally. "
                        "Set MEMORY_EMBEDDING_MODEL_PATH to a local 384-dimensional "
                        "Transformers model directory."
                    ) from exc

            import torch

            inputs = self._tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=256,
                padding=True,
            )
            with torch.inference_mode():
                output = self._model(**inputs)
                token_embeddings = output.last_hidden_state
                mask = inputs["attention_mask"].unsqueeze(-1).to(token_embeddings.dtype)
                pooled = (token_embeddings * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1)
                pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
            vector = pooled[0].cpu().tolist()
            if len(vector) != EMBEDDING_DIMENSIONS:
                raise ValueError(
                    f"Configured local embedding model returned {len(vector)} dimensions; "
                    f"expected {EMBEDDING_DIMENSIONS}"
                )
            return vector


class ScamMemoryService:
    """Persistence and retrieval API for validated scam-pattern memory."""

    def __init__(
        self,
        db_client: Any | None = None,
        embedder: Any | None = None,
    ):
        self._db_client = db_client
        self._embedder = embedder or LocalEmbeddingModel()
        self._stats_lock = threading.Lock()
        self._stats = {
            "retrievals": 0,
            "semantic_queries": 0,
            "lexical_queries": 0,
            "semantic_hits": 0,
            "lexical_hits": 0,
            "misses": 0,
            "retrieval_errors": 0,
            "total_latency_ms": 0.0,
        }

    def _client(self):
        return self._db_client if self._db_client is not None else get_supabase()

    def _embedding(self, normalized_text: str) -> list[float] | None:
        vector = self._embedder.encode(normalized_text)
        if vector is None:
            return None
        if len(vector) != EMBEDDING_DIMENSIONS:
            raise ValueError(
                f"Embedding has {len(vector)} dimensions; expected {EMBEDDING_DIMENSIONS}"
            )
        if not all(math.isfinite(float(value)) for value in vector):
            raise ValueError("Embedding contains a non-finite value")
        return [float(value) for value in vector]

    def _validated_pattern(
        self,
        pattern: Mapping[str, Any],
        evidence: Mapping[str, Any],
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        if not isinstance(pattern, Mapping):
            raise ValueError("pattern must be a mapping")
        if _DISALLOWED_KEYS.intersection(str(key).casefold() for key in pattern):
            raise ValueError("Raw transcripts, audio, and caller identifiers are not accepted")
        unknown = set(pattern) - _PATTERN_KEYS
        if unknown:
            raise ValueError(f"Unsupported pattern fields: {', '.join(sorted(unknown))}")

        summary = _clean_text(pattern.get("summary"), "summary")
        scam_type = _clean_text(pattern.get("scam_type"), "scam_type", 80).casefold()
        normalized_text = normalize_claim(_clean_text(pattern.get("normalized_text"), "normalized_text"))
        if not normalized_text:
            raise ValueError("normalized_text must contain searchable text")
        tactics = _clean_string_list(pattern.get("tactics", []), "tactics")
        phrases = _clean_string_list(pattern.get("phrases", []), "phrases")
        organizations = _clean_string_list(
            pattern.get("impersonated_orgs", []),
            "impersonated_orgs",
        )
        indicators = _clean_string_list(
            pattern.get("risk_indicators", []),
            "risk_indicators",
        )
        canonical_key = hashlib.sha256(
            f"{scam_type}\0{normalized_text}".encode("utf-8")
        ).hexdigest()
        search_text = " ".join(
            [summary, normalized_text, scam_type, *tactics, *phrases, *organizations, *indicators]
        )[:4000]
        safe_pattern = {
            "canonical_key": canonical_key,
            "summary": summary,
            "normalized_text": normalized_text,
            "search_text": search_text,
            "scam_type": scam_type,
            "tactics": tactics,
            "phrases": phrases,
            "impersonated_orgs": organizations,
            "risk_indicators": indicators,
        }
        return safe_pattern, _validated_evidence(evidence)

    def ingest_verified_pattern(
        self,
        pattern: Mapping[str, Any],
        validated_evidence: Mapping[str, Any],
    ) -> dict[str, Any]:
        safe_pattern, evidence = self._validated_pattern(pattern, validated_evidence)
        normalized_text = safe_pattern["normalized_text"]
        embedding = self._embedding(normalized_text)
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(days=VERIFICATION_MAX_AGE_DAYS)
        payload = {
            **safe_pattern,
            "verification_status": "verified",
            "confidence": evidence["confidence"],
            "corroboration_count": len(evidence["source_domains"]),
            "source_urls": evidence["source_urls"],
            "source_domains": evidence["source_domains"],
            "evidence_refs": evidence["evidence_refs"],
            "embedding": embedding,
            "embedding_model": self._embedder.model_name,
            "active": True,
            "occurrence_count": 1,
            "last_seen_at": now.isoformat(),
            "last_verified_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
        }
        result = self._client().table("scam_pattern_memory").upsert(
            payload,
            on_conflict="canonical_key",
        ).select("*").execute()
        if not result.data:
            raise RuntimeError("Supabase did not return the persisted scam memory pattern")
        return result.data[0]

    def retrieve_patterns(
        self,
        claim: str,
        top_k: int = DEFAULT_TOP_K,
        similarity_threshold: float = 0.72,
    ) -> list[dict[str, Any]]:
        started_at = time.perf_counter()
        normalized_text = normalize_claim(claim)
        if not normalized_text:
            return []
        if not isinstance(top_k, int) or isinstance(top_k, bool) or top_k < 1:
            raise ValueError("top_k must be a positive integer")
        top_k = min(top_k, MAX_TOP_K)
        if not 0.0 <= similarity_threshold <= 1.0:
            raise ValueError("similarity_threshold must be between 0 and 1")

        results: list[dict[str, Any]] = []
        semantic_error = False
        try:
            vector = self._embedding(normalized_text)
        except RuntimeError as exc:
            vector = None
            with self._stats_lock:
                self._stats["retrieval_errors"] += 1
            logger.warning("Local memory embeddings unavailable; using lexical search: %s", exc)
        if vector is not None:
            with self._stats_lock:
                self._stats["semantic_queries"] += 1
            try:
                response = self._client().rpc(
                    "match_scam_pattern_memory",
                    {
                        "query_embedding": "[" + ",".join(str(value) for value in vector) + "]",
                        "match_threshold": similarity_threshold,
                        "match_count": top_k,
                        "query_embedding_model": self._embedder.model_name,
                    },
                ).execute()
                results.extend(self._validated_hits(response.data or [], "semantic"))
            except Exception as exc:
                semantic_error = True
                with self._stats_lock:
                    self._stats["retrieval_errors"] += 1
                logger.warning("Semantic scam-memory retrieval failed; trying lexical search: %s", exc)

        lexical_needed = vector is None or semantic_error or len(results) < top_k
        if lexical_needed:
            with self._stats_lock:
                self._stats["lexical_queries"] += 1
            try:
                response = self._client().rpc(
                    "search_scam_pattern_memory_keyword",
                    {"search_query": normalized_text[:500], "match_count": top_k},
                ).execute()
                results.extend(self._validated_hits(response.data or [], "lexical"))
            except Exception as exc:
                with self._stats_lock:
                    self._stats["retrieval_errors"] += 1
                if not results:
                    raise RuntimeError("Both semantic and lexical scam-memory retrieval failed") from exc
                logger.warning("Lexical scam-memory fallback failed: %s", exc)

        merged: dict[str, dict[str, Any]] = {}
        for hit in results:
            key = hit.get("canonical_key")
            if not key:
                continue
            existing = merged.get(key)
            if existing is None:
                merged[key] = hit
            elif hit["retrieval_method"] == "semantic" and existing["retrieval_method"] == "lexical":
                merged[key] = hit

        ordered = list(merged.values())[:top_k]
        with self._stats_lock:
            self._stats["retrievals"] += 1
            self._stats["semantic_hits"] += sum(
                hit["retrieval_method"] == "semantic" for hit in ordered
            )
            self._stats["lexical_hits"] += sum(
                hit["retrieval_method"] == "lexical" for hit in ordered
            )
            if not ordered:
                self._stats["misses"] += 1
            self._stats["total_latency_ms"] += (time.perf_counter() - started_at) * 1000
        return ordered

    @staticmethod
    def _validated_hits(rows: Sequence[Mapping[str, Any]], method: str) -> list[dict[str, Any]]:
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=VERIFICATION_MAX_AGE_DAYS)
        valid = []
        for row in rows:
            if row.get("verification_status") != "verified" or not row.get("active", True):
                continue
            try:
                verified_at = datetime.fromisoformat(
                    str(row.get("last_verified_at", "")).replace("Z", "+00:00")
                )
                expires_at_value = row.get("expires_at")
                expires_at = (
                    datetime.fromisoformat(str(expires_at_value).replace("Z", "+00:00"))
                    if expires_at_value
                    else None
                )
                if verified_at.tzinfo is None:
                    verified_at = verified_at.replace(tzinfo=timezone.utc)
                if verified_at < cutoff or (expires_at is not None and expires_at <= now):
                    continue
            except (TypeError, ValueError):
                continue
            safe_row = dict(row)
            safe_row["retrieval_method"] = method
            valid.append(safe_row)
        return valid

    def mark_pattern_verified(
        self,
        canonical_key: str,
        validated_evidence: Mapping[str, Any],
    ) -> dict[str, Any]:
        evidence = _validated_evidence(validated_evidence)
        now = datetime.now(timezone.utc)
        result = (
            self._client()
            .table("scam_pattern_memory")
            .update({
                "verification_status": "verified",
                "active": True,
                "confidence": evidence["confidence"],
                "corroboration_count": len(evidence["source_domains"]),
                "source_urls": evidence["source_urls"],
                "source_domains": evidence["source_domains"],
                "evidence_refs": evidence["evidence_refs"],
                "last_verified_at": now.isoformat(),
                "expires_at": (now + timedelta(days=VERIFICATION_MAX_AGE_DAYS)).isoformat(),
            })
            .eq("canonical_key", canonical_key)
            .select("*")
            .execute()
        )
        if not result.data:
            raise LookupError(f"No scam-memory pattern found for canonical key {canonical_key}")
        return result.data[0]

    def mark_pattern_stale(self, canonical_key: str) -> dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        result = (
            self._client()
            .table("scam_pattern_memory")
            .update({"active": False, "expires_at": now})
            .eq("canonical_key", canonical_key)
            .select("*")
            .execute()
        )
        if not result.data:
            raise LookupError(f"No scam-memory pattern found for canonical key {canonical_key}")
        return result.data[0]

    def get_retrieval_stats(self) -> dict[str, int | float]:
        with self._stats_lock:
            stats = dict(self._stats)
        retrievals = int(stats["retrievals"])
        stats["average_latency_ms"] = (
            round(float(stats["total_latency_ms"]) / retrievals, 2) if retrievals else 0.0
        )
        stats.pop("total_latency_ms")
        return stats


_default_service = ScamMemoryService()


def ingest_verified_pattern(
    pattern: Mapping[str, Any],
    validated_evidence: Mapping[str, Any],
) -> dict[str, Any]:
    return _default_service.ingest_verified_pattern(pattern, validated_evidence)


def retrieve_patterns(
    claim: str,
    top_k: int = DEFAULT_TOP_K,
    similarity_threshold: float = 0.72,
) -> list[dict[str, Any]]:
    return _default_service.retrieve_patterns(claim, top_k, similarity_threshold)


def mark_pattern_verified(
    canonical_key: str,
    validated_evidence: Mapping[str, Any],
) -> dict[str, Any]:
    return _default_service.mark_pattern_verified(canonical_key, validated_evidence)


def mark_pattern_stale(canonical_key: str) -> dict[str, Any]:
    return _default_service.mark_pattern_stale(canonical_key)


def get_retrieval_stats() -> dict[str, int | float]:
    return _default_service.get_retrieval_stats()
