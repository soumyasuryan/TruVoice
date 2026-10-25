"""Bounded LangGraph router for side-path scam-memory verification."""

from __future__ import annotations

import asyncio
import functools
import hashlib
import logging
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, TypedDict
from urllib.parse import urlsplit, urlunsplit

from langgraph.graph import END, StateGraph

from app.config import settings
from app.services.scam_memory_service import ScamMemoryService, normalize_claim
from app.services.web_verification_service import (
    CLAIM_PATTERNS,
    compute_web_verification_risk,
    detect_claims_and_questions,
    scrub_pii,
    verify_claim_pipeline,
)
from app.utils.websocket_manager import manager

logger = logging.getLogger(__name__)
_MEMORY_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="scam-memory")

STRONG_MATCH_SIMILARITY = 0.84
STRONG_MATCH_CONFIDENCE = 0.80
MAX_CALL_CONTEXTS = 256
MAX_CLAIMS_PER_CALL = 128
CALL_CONTEXT_TTL_SECONDS = 3600


class RoutingState(TypedDict, total=False):
    call_id: str
    claim: str
    claim_type: str
    entity: str
    question: str
    normalized_entity: str
    normalized_question: str
    base_score: float
    base_level: str
    recent_memory_hits: list[dict[str, Any]]
    normalized_claim: str
    claim_key: str
    memory_hits: list[dict[str, Any]]
    memory_error: bool
    selected_memory: dict[str, Any] | None
    duplicate_result: dict[str, Any] | None
    route: str
    verification: dict[str, Any] | None
    verification_valid: bool
    persistence_scheduled: bool
    memory_status: str
    risk_evidence: bool
    final_score: float
    final_level: str
    risk_update: dict[str, Any]
    context: Any
    emit: bool


class _CallContext:
    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.claim_results: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self.verification_count = 0
        self.last_verification_at = 0.0
        self.memory_floor_score = 0.0
        self.memory_floor_level = "SAFE"
        self.last_used_at = time.monotonic()


VerifyFunction = Callable[..., Awaitable[dict[str, Any]]]
EmitFunction = Callable[[str, str, dict[str, Any]], Awaitable[None]]


async def _run_memory_job(function: Callable[..., Any], *args: Any) -> Any:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        _MEMORY_EXECUTOR,
        functools.partial(function, *args),
    )


class MemoryRoutingWorkflow:
    """Explicit one-pass memory router with bounded per-call state."""

    def __init__(
        self,
        memory_service: ScamMemoryService | Any | None = None,
        verify_function: VerifyFunction | None = None,
        emit_function: EmitFunction | None = None,
    ):
        self.memory_service = memory_service or ScamMemoryService()
        self.verify_function = verify_function or verify_claim_pipeline
        self.emit_function = emit_function or manager.emit_call_event
        self._contexts: OrderedDict[str, _CallContext] = OrderedDict()
        self._contexts_lock = asyncio.Lock()
        self._persistence_tasks: set[asyncio.Task] = set()
        self._graph = self._build_graph()

    def _build_graph(self):
        graph = StateGraph(RoutingState)
        graph.add_node("normalize_claim", self._normalize_claim)
        graph.add_node("retrieve_memory", self._retrieve_memory)
        graph.add_node("route_known_or_new", self._route_known_or_new)
        graph.add_node("reuse_memory_context", self._reuse_memory_context)
        graph.add_node("verify_with_tinyfish", self._verify_with_tinyfish)
        graph.add_node("validate_and_persist", self._validate_and_persist)
        graph.add_node("update_risk_with_memory_context", self._update_risk_with_memory_context)
        graph.add_node("emit_update", self._emit_update)

        graph.set_entry_point("normalize_claim")
        graph.add_edge("normalize_claim", "retrieve_memory")
        graph.add_edge("retrieve_memory", "route_known_or_new")
        graph.add_conditional_edges(
            "route_known_or_new",
            self._route_name,
            {
                "reuse": "reuse_memory_context",
                "verify": "verify_with_tinyfish",
                "skip": "update_risk_with_memory_context",
            },
        )
        graph.add_edge("reuse_memory_context", "update_risk_with_memory_context")
        graph.add_edge("verify_with_tinyfish", "validate_and_persist")
        graph.add_edge("validate_and_persist", "update_risk_with_memory_context")
        graph.add_edge("update_risk_with_memory_context", "emit_update")
        graph.add_edge("emit_update", END)
        return graph.compile()

    @staticmethod
    def _route_name(state: RoutingState) -> str:
        route = state.get("route", "skip")
        return "reuse" if route == "duplicate" else route

    async def _get_call_context(self, call_id: str) -> _CallContext:
        now = time.monotonic()
        async with self._contexts_lock:
            expired = [
                key
                for key, context in self._contexts.items()
                if now - context.last_used_at > CALL_CONTEXT_TTL_SECONDS
                and not context.lock.locked()
            ]
            for key in expired:
                self._contexts.pop(key, None)

            context = self._contexts.get(call_id)
            if context is None:
                context = _CallContext()
                self._contexts[call_id] = context
            context.last_used_at = now
            self._contexts.move_to_end(call_id)
            while len(self._contexts) > MAX_CALL_CONTEXTS:
                oldest_id, oldest_context = next(iter(self._contexts.items()))
                if oldest_context.lock.locked():
                    break
                self._contexts.pop(oldest_id, None)
            return context

    def get_call_risk_floor(self, call_id: str) -> dict[str, Any] | None:
        """Return the active memory-derived floor for cheap live-update clamping."""
        context = self._contexts.get(str(call_id))
        if context is None or time.monotonic() - context.last_used_at > CALL_CONTEXT_TTL_SECONDS:
            return None
        if context.memory_floor_score <= 0.0 and context.memory_floor_level == "SAFE":
            return None
        return {
            "score": context.memory_floor_score,
            "level": context.memory_floor_level,
        }

    async def process_claim(
        self,
        *,
        call_id: str,
        claim: str,
        claim_type: str,
        base_score: float,
        base_level: str,
        entity: str = "",
        question: str = "",
        recent_memory_hits: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Run one claim through the graph; callers should schedule this off-path."""
        if not call_id:
            raise ValueError("call_id is required for memory routing")
        try:
            score = float(base_score)
        except (TypeError, ValueError) as exc:
            raise ValueError("base_score must be numeric") from exc
        if not 0.0 <= score <= 100.0:
            raise ValueError("base_score must be between 0 and 100")

        if not question:
            question = next(
                (
                    item["question"]
                    for item in CLAIM_PATTERNS
                    if item["id"] == claim_type
                ),
                "Do legitimate organizations make this request during unsolicited calls?",
            )
        safe_claim = scrub_pii(claim)
        safe_question = scrub_pii(question)
        safe_entity = scrub_pii(entity)
        context = await self._get_call_context(str(call_id))
        async with context.lock:
            context.last_used_at = time.monotonic()
            normalized_level = self._normalize_level(base_level, score)
            state: RoutingState = {
                "call_id": str(call_id),
                "claim": safe_claim,
                "claim_type": str(claim_type or "unknown")[:80],
                "entity": safe_entity[:160],
                "question": safe_question[:500],
                "base_score": score,
                "base_level": normalized_level,
                "recent_memory_hits": recent_memory_hits or [],
                "context": context,
                "emit": True,
            }
            try:
                result = await self._graph.ainvoke(state)
            except Exception:
                logger.exception(
                    "Memory routing failed open for call %s, claim type %s",
                    call_id,
                    state["claim_type"],
                )
                memory_floor = context.memory_floor_score
                return {
                    "status": "fail_open",
                    "final_score": max(score, memory_floor),
                    "final_level": self._higher_level(
                        normalized_level,
                        context.memory_floor_level,
                    ),
                }

            key = result.get("claim_key")
            if key and result.get("route") != "skip":
                outcome = self._compact_outcome(result)
                context.claim_results[key] = outcome
                context.claim_results.move_to_end(key)
                while len(context.claim_results) > MAX_CLAIMS_PER_CALL:
                    context.claim_results.popitem(last=False)
            return {
                "status": result.get("memory_status", "fail_open"),
                "route": result.get("route", "skip"),
                "final_score": result.get("final_score", score),
                "final_level": result.get("final_level", normalized_level),
                "deduplicated": result.get("route") == "duplicate",
                "matched_pattern": result.get("selected_memory", {}).get("canonical_key")
                if result.get("selected_memory")
                else None,
            }

    async def _normalize_claim(self, state: RoutingState) -> dict[str, Any]:
        normalized, normalized_question, normalized_entity = await _run_memory_job(
            self._normalize_inputs,
            state["claim"],
            state.get("question", ""),
            state.get("entity", ""),
        )
        claim_key = hashlib.sha256(
            f"{state['claim_type']}\0{normalized}".encode("utf-8")
        ).hexdigest()
        context: _CallContext = state["context"]
        previous = context.claim_results.get(claim_key)
        return {
            "normalized_claim": normalized[:500],
            "normalized_question": normalized_question[:500],
            "normalized_entity": normalized_entity[:160],
            "claim_key": claim_key,
            "duplicate_result": previous,
        }

    @staticmethod
    def _normalize_inputs(claim: str, question: str, entity: str) -> tuple[str, str, str]:
        return (
            normalize_claim(claim),
            normalize_claim(question),
            normalize_claim(entity),
        )

    async def _retrieve_memory(self, state: RoutingState) -> dict[str, Any]:
        if state.get("duplicate_result") is not None:
            return {"memory_hits": []}

        supplied_hits = state.get("recent_memory_hits") or []
        if supplied_hits:
            return {"memory_hits": self._fresh_hits(supplied_hits)}
        if not state.get("normalized_claim"):
            return {"memory_hits": []}
        try:
            hits = await _run_memory_job(
                self.memory_service.retrieve_patterns,
                state["normalized_claim"],
                5,
            )
            return {"memory_hits": self._fresh_hits(hits)}
        except Exception:
            logger.exception(
                "Scam-memory retrieval failed for call %s",
                state["call_id"],
            )
            return {"memory_hits": [], "memory_error": True}

    @staticmethod
    def _fresh_hits(hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=180)
        fresh = []
        for hit in hits[:5]:
            if hit.get("verification_status") != "verified" or not hit.get("active", True):
                continue
            try:
                verified_at = datetime.fromisoformat(
                    str(hit.get("last_verified_at", "")).replace("Z", "+00:00")
                )
                expires_at = hit.get("expires_at")
                expires = (
                    datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
                    if expires_at
                    else None
                )
                if verified_at.tzinfo is None:
                    verified_at = verified_at.replace(tzinfo=timezone.utc)
                if verified_at < cutoff or (expires is not None and expires <= now):
                    continue
            except (TypeError, ValueError):
                continue
            fresh.append(hit)
        return fresh

    async def _route_known_or_new(self, state: RoutingState) -> dict[str, Any]:
        previous = state.get("duplicate_result")
        if previous is not None:
            return {
                "route": "duplicate",
                "memory_status": "repeated_claim_reused",
                "duplicate_result": previous,
            }

        if not state.get("normalized_claim"):
            return {
                "route": "skip",
                "memory_status": "empty_sanitized_claim",
            }

        hits = state.get("memory_hits", [])
        matching = []
        for hit in hits:
            similarity = self._number(hit.get("similarity"), -1.0)
            if similarity < 0.0 and (
                hit.get("retrieval_method") == "lexical"
                or hit.get("keyword_rank") is not None
            ):
                similarity = self._lexical_similarity(
                    state["normalized_claim"],
                    str(hit.get("normalized_text", "")),
                )
            confidence = self._number(hit.get("confidence"), 0.0)
            if (
                hit.get("scam_type") == state.get("claim_type")
                and similarity >= STRONG_MATCH_SIMILARITY
                and confidence >= STRONG_MATCH_CONFIDENCE
                and self._entity_matches(state.get("normalized_entity", ""), hit)
            ):
                matching.append(hit)
        matching.sort(key=lambda hit: self._number(hit.get("similarity"), 0.0), reverse=True)

        ambiguous = (
            len(matching) > 1
            and abs(
                self._number(matching[0].get("similarity"), 0.0)
                - self._number(matching[1].get("similarity"), 0.0)
            ) < 0.02
            and matching[0].get("canonical_key") != matching[1].get("canonical_key")
        )
        if matching and not ambiguous:
            return {
                "route": "reuse",
                "selected_memory": matching[0],
                "memory_status": "verified_memory_reused",
            }

        if not state.get("normalized_question"):
            return {
                "route": "skip",
                "memory_status": "question_unavailable_for_verification",
            }

        context: _CallContext = state["context"]
        now = time.monotonic()
        budget_available = (
            settings.TINYFISH_ENABLED
            and context.verification_count < settings.CLAIM_MAX_PER_CALL
            and (
                context.last_verification_at == 0
                or now - context.last_verification_at >= settings.CLAIM_MIN_GAP_S
            )
        )
        if not budget_available:
            reason = "verification_disabled_or_call_budget_exhausted"
            return {
                "route": "skip",
                "memory_status": reason,
            }
        context.verification_count += 1
        context.last_verification_at = now
        return {
            "route": "verify",
            "memory_status": "verification_requested",
        }

    @staticmethod
    def _number(value: Any, default: float) -> float:
        try:
            number = float(value)
            return number if number == number else default
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _entity_matches(entity: str, hit: dict[str, Any]) -> bool:
        if not entity:
            return True
        organizations = hit.get("impersonated_orgs") or []
        if not organizations:
            return True
        normalized_entity = " ".join(entity.casefold().split())
        return any(
            normalized_entity in " ".join(str(org).casefold().split())
            or " ".join(str(org).casefold().split()) in normalized_entity
            for org in organizations
        )

    @staticmethod
    def _lexical_similarity(claim: str, pattern: str) -> float:
        claim_tokens = set(claim.split())
        pattern_tokens = set(pattern.split())
        if not claim_tokens or not pattern_tokens:
            return 0.0
        if claim_tokens == pattern_tokens:
            return 1.0
        if min(len(claim_tokens), len(pattern_tokens)) < 4:
            return 0.0
        return len(claim_tokens & pattern_tokens) / min(len(claim_tokens), len(pattern_tokens))

    async def _reuse_memory_context(self, state: RoutingState) -> dict[str, Any]:
        if state.get("duplicate_result") is not None:
            previous = state["duplicate_result"]
            return {
                "selected_memory": previous.get("selected_memory"),
                "verification": previous.get("verification"),
                "verification_valid": previous.get("verification_valid", False),
                "risk_evidence": previous.get("risk_evidence", False),
                "memory_status": "repeated_claim_reused",
                "previous_final_score": previous.get("final_score", 0.0),
                "previous_final_level": previous.get("final_level", "SAFE"),
                "emit": False,
            }
        return {
            "risk_evidence": state.get("selected_memory") is not None,
            "memory_status": state.get("memory_status", "verified_memory_reused"),
        }

    async def _verify_with_tinyfish(self, state: RoutingState) -> dict[str, Any]:
        try:
            evidence = await self.verify_function(
                call_id=state["call_id"],
                claim_id=state["claim_type"],
                claim_text=state["normalized_claim"],
                question=state.get("normalized_question", ""),
            )
            return {
                "verification": evidence,
                "memory_status": "verification_completed",
            }
        except Exception:
            logger.exception(
                "TinyFish verification failed open for call %s, claim type %s",
                state["call_id"],
                state["claim_type"],
            )
            return {
                "verification": None,
                "memory_status": "verification_failed_open",
            }

    async def _validate_and_persist(self, state: RoutingState) -> dict[str, Any]:
        evidence = state.get("verification")
        if not isinstance(evidence, dict):
            return {
                "verification_valid": False,
                "risk_evidence": False,
                "memory_status": state.get("memory_status", "verification_failed_open"),
            }
        confidence = self._number(evidence.get("confidence"), 0.0)
        compact_evidence = self._compact_evidence(evidence)
        validated = (
            str(evidence.get("verdict", "")).upper() == "CONTRADICTED"
            and STRONG_MATCH_CONFIDENCE <= confidence <= 1.0
            and bool(compact_evidence["sources"])
        )
        if not validated:
            return {
                "verification_valid": False,
                "risk_evidence": False,
                "memory_status": "verification_unconfirmed",
            }

        safe_claim = state["normalized_claim"][:500]
        pattern = {
            "summary": safe_claim,
            "normalized_text": safe_claim,
            "scam_type": state["claim_type"],
            "tactics": [],
            "phrases": [],
            "impersonated_orgs": (
                [state["normalized_entity"]]
                if state.get("normalized_entity")
                else []
            ),
            "risk_indicators": [],
        }
        persist_task = asyncio.create_task(
            _run_memory_job(
                self.memory_service.ingest_verified_pattern,
                pattern,
                compact_evidence,
            )
        )
        self._persistence_tasks.add(persist_task)

        def persist_done(task: asyncio.Task) -> None:
            self._persistence_tasks.discard(task)
            try:
                task.result()
            except Exception:
                logger.exception(
                    "Validated scam pattern persistence failed for call %s",
                    state["call_id"],
                )

        persist_task.add_done_callback(persist_done)
        return {
            "verification_valid": True,
            "risk_evidence": True,
            "persistence_scheduled": True,
            "memory_status": "verified_evidence",
        }

    @staticmethod
    def _compact_evidence(evidence: dict[str, Any]) -> dict[str, Any]:
        sources = []
        raw_sources = evidence.get("sources")
        if not isinstance(raw_sources, list):
            raw_sources = []
        for source in raw_sources[:5]:
            if not isinstance(source, dict):
                continue
            try:
                parsed = urlsplit(str(source.get("url", "")))
                if parsed.scheme.lower() != "https" or not parsed.hostname:
                    continue
                if parsed.username or parsed.password:
                    continue
                hostname = parsed.hostname.encode("idna").decode("ascii").lower()
                port = parsed.port
                netloc = hostname if port in (None, 443) else f"{hostname}:{port}"
                sources.append({
                    "url": urlunsplit(("https", netloc, parsed.path[:500], "", "")),
                })
            except (UnicodeError, ValueError):
                continue
        return {
            "verdict": str(evidence.get("verdict", "")).upper(),
            "confidence": evidence.get("confidence", 0.0),
            "sources": sources,
        }

    async def _update_risk_with_memory_context(self, state: RoutingState) -> dict[str, Any]:
        base_score = state["base_score"]
        base_level = state["base_level"]
        if state.get("risk_evidence"):
            computed = compute_web_verification_risk(
                base_score=base_score,
                base_level=base_level,
                contradicted_count=1,
            )
            final_score = max(base_score, computed["final_score"])
            final_level = self._higher_level(base_level, computed["final_level"])
            reason = (
                "A recently verified scam pattern matched this claim."
                if state.get("selected_memory")
                else "Validated external evidence contradicted this claim."
            )
            context: _CallContext = state["context"]
            context.memory_floor_score = max(context.memory_floor_score, final_score)
            context.memory_floor_level = self._higher_level(
                context.memory_floor_level,
                final_level,
            )
        else:
            final_score = base_score
            final_level = base_level
            reason = "Memory did not provide validated evidence."

        previous_score = self._number(state.get("previous_final_score"), 0.0)
        previous_level = state.get("previous_final_level", "SAFE")
        context: _CallContext = state["context"]
        final_score = max(final_score, previous_score, context.memory_floor_score)
        final_level = self._higher_level(
            final_level,
            self._higher_level(previous_level, context.memory_floor_level),
        )
        return {
            "final_score": final_score,
            "final_level": final_level,
            "risk_update": {
                "call_id": state["call_id"],
                "base_score": base_score,
                "final_score": final_score,
                "base_level": base_level,
                "final_level": final_level,
                "web_boost": max(0.0, final_score - base_score),
                "reasons": [reason] if state.get("risk_evidence") else [],
            },
        }

    async def _emit_update(self, state: RoutingState) -> dict[str, Any]:
        if not state.get("emit", True):
            return {}
        event = {
            "call_id": state["call_id"],
            "status": state.get("memory_status", "no_memory_match"),
            "claim_type": state["claim_type"],
            "matched_pattern": (
                state.get("selected_memory", {}).get("canonical_key")
                if state.get("selected_memory")
                else None
            ),
            "confidence": (
                state.get("selected_memory", {}).get("confidence")
                if state.get("selected_memory")
                else (
                    state.get("verification", {}).get("confidence")
                    if state.get("verification_valid")
                    else None
                )
            ),
            "persistence_scheduled": state.get("persistence_scheduled", False),
        }
        try:
            await self.emit_function(state["call_id"], "memory_update", event)
            risk_update = state.get("risk_update", {})
            if (
                risk_update
                and (
                    risk_update["final_score"] > risk_update["base_score"]
                    or self._level_rank(risk_update["final_level"])
                    > self._level_rank(risk_update["base_level"])
                )
            ):
                await self.emit_function(state["call_id"], "risk_update", risk_update)
        except Exception:
            logger.exception("Unable to emit memory routing update for call %s", state["call_id"])
        return {}

    @staticmethod
    def _normalize_level(level: str, score: float) -> str:
        normalized = str(level or "").upper()
        if normalized not in ("SAFE", "MODERATE", "SEVERE"):
            if score >= 85:
                return "SEVERE"
            if score >= 60:
                return "MODERATE"
            return "SAFE"
        return normalized

    @classmethod
    def _level_rank(cls, level: str) -> int:
        return {"SAFE": 0, "MODERATE": 1, "SEVERE": 2}.get(
            cls._normalize_level(level, 0.0),
            0,
        )

    @classmethod
    def _higher_level(cls, first: str, second: str) -> str:
        normalized_first = cls._normalize_level(first, 0.0)
        normalized_second = cls._normalize_level(second, 0.0)
        return (
            normalized_first
            if cls._level_rank(normalized_first) >= cls._level_rank(normalized_second)
            else normalized_second
        )

    @staticmethod
    def _compact_outcome(state: RoutingState) -> dict[str, Any]:
        selected = state.get("selected_memory")
        compact_hit = None
        if selected:
            compact_hit = {
                key: selected[key]
                for key in (
                    "canonical_key",
                    "scam_type",
                    "verification_status",
                    "active",
                    "confidence",
                    "similarity",
                    "last_verified_at",
                    "expires_at",
                    "impersonated_orgs",
                )
                if key in selected
            }
        return {
            "selected_memory": compact_hit,
            "verification_valid": state.get("verification_valid", False),
            "risk_evidence": state.get("risk_evidence", False),
            "memory_status": state.get("memory_status"),
            "final_score": state.get("final_score", 0.0),
            "final_level": state.get("final_level", "SAFE"),
        }

    async def process_transcript(
        self,
        *,
        call_id: str,
        sanitized_transcript: str,
        base_score: float,
        base_level: str,
    ) -> list[dict[str, Any]]:
        """Route detected generic claims from sanitized text without storing it."""
        detected = await _run_memory_job(
            detect_claims_and_questions,
            sanitized_transcript,
        )
        results = []
        for claim in detected[: max(0, settings.CLAIM_MAX_PER_CALL)]:
            results.append(
                await self.process_claim(
                    call_id=call_id,
                    claim=claim["claim_text"],
                    claim_type=claim["claim_id"],
                    question=claim["question"],
                    base_score=base_score,
                    base_level=base_level,
                )
            )
        return results


memory_routing_workflow = MemoryRoutingWorkflow()


def get_call_memory_risk_floor(call_id: str) -> dict[str, Any] | None:
    return memory_routing_workflow.get_call_risk_floor(call_id)


async def route_call_claim(
    *,
    call_id: str,
    sanitized_transcript: str,
    base_score: float,
    base_level: str,
) -> list[dict[str, Any]]:
    """Entry point intended to be scheduled as a background call task."""
    try:
        return await memory_routing_workflow.process_transcript(
            call_id=call_id,
            sanitized_transcript=sanitized_transcript,
            base_score=base_score,
            base_level=base_level,
        )
    except Exception:
        logger.exception("Memory routing side path failed for call %s", call_id)
        return []
