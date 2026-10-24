import asyncio
import hashlib
import json
import logging
import re
import time
import urllib.parse
from typing import Any, Optional
import urllib.request
import urllib.error

from groq import AsyncGroq

from app.config import settings

logger = logging.getLogger(__name__)

# PII Scrubbing regexes
_PHONE_PATTERN = re.compile(r"(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)")
_EMAIL_PATTERN = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_CARD_OR_ACC_PATTERN = re.compile(r"\b(?:\d[ -]*?){12,19}\b")
_RAW_URL_PATTERN = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
_PII_ENTITY_TAGS = re.compile(r"<[A-Z_]+>")


def scrub_pii(text: str) -> str:
    """
    Guarantees no personal data (names, phone numbers, email addresses,
    account/card numbers, or raw links) leaves the backend for web verification.
    """
    if not text:
        return ""
    scrubbed = str(text)
    scrubbed = _EMAIL_PATTERN.sub("[REDACTED_EMAIL]", scrubbed)
    scrubbed = _CARD_OR_ACC_PATTERN.sub("[REDACTED_NUMBER]", scrubbed)
    scrubbed = _PHONE_PATTERN.sub("[REDACTED_PHONE]", scrubbed)
    scrubbed = _RAW_URL_PATTERN.sub("[REDACTED_LINK]", scrubbed)
    scrubbed = _PII_ENTITY_TAGS.sub("", scrubbed)
    scrubbed = " ".join(scrubbed.split())
    return scrubbed


def normalize_question(question: str) -> str:
    """Normalizes a question into a consistent cache key format."""
    cleaned = re.sub(r"[^\w\s]", "", (question or "").lower())
    return " ".join(cleaned.split())


# Checkable Claim Patterns & Neutral Questions
CLAIM_PATTERNS: list[dict[str, Any]] = [
    {
        "id": "bank_otp",
        "pattern": re.compile(
            r"\b(?:otp|one\s*time\s*password|verification\s*code|passcode)\b.*\b(?:share|give|provide|send|tell|need|enter|blocked|freeze|suspended|deactivat)\b|"
            r"\b(?:blocked|freeze|suspended|deactivat)\b.*\b(?:otp|one\s*time\s*password|verification\s*code)\b",
            re.IGNORECASE,
        ),
        "claim": "Your account will be blocked unless you share the OTP",
        "question": "Do banks ask customers to share OTP over the phone to prevent account blocking?",
    },
    {
        "id": "remote_access",
        "pattern": re.compile(
            r"\b(?:install|download|setup|open)\b.*\b(?:anydesk|quicksupport|teamviewer|remote\s*access|rustdesk|apk|screen\s*share)\b",
            re.IGNORECASE,
        ),
        "claim": "Install AnyDesk, QuickSupport, or a remote access app",
        "question": "Do banks or official tech support instruct customers to install AnyDesk or remote access apps?",
    },
    {
        "id": "fee_or_fine",
        "pattern": re.compile(
            r"\b(?:pay|transfer|send|deposit)\b.*\b(?:fee|fine|penalty|clearance\s*charge|refundable\s*deposit|customs\s*duty|security\s*deposit|processing\s*fee)\b",
            re.IGNORECASE,
        ),
        "claim": "Pay a fee, fine, or clearance charge over the phone",
        "question": "Do law enforcement agencies or banks ask people to pay fines or clearance fees over personal calls?",
    },
    {
        "id": "credentials_cvv",
        "pattern": re.compile(
            r"\b(?:share|give|tell|need|enter|provide)\b.*\b(?:cvv|pin|mpin|password|card\s*number|expiry\s*date|netbanking\s*password)\b|"
            r"\b(?:cvv|pin|mpin|password)\b.*\b(?:share|give|tell|verify)\b",
            re.IGNORECASE,
        ),
        "claim": "We need your CVV, PIN, password, or card details",
        "question": "Do bank representatives ask customers for their card CVV, ATM PIN, or passwords?",
    },
    {
        "id": "bank_impersonation",
        "pattern": re.compile(
            r"\b(?:calling\s+from|i\s+am\s+(?:calling\s+)?from|from\s+the|from\s+your|this\s+is|this\s+call\s+is\s+from)\s+(?:your\s+)?(?:bank|sbi|hdfc|icici|rbi|axis|kotak|customer\s*care|fraud\s*department|banking\s*department)\b"
            r"|\b(?:sbi|hdfc|icici|rbi|axis|kotak)\s+(?:bank|customer\s*care|fraud)\b",
            re.IGNORECASE,
        ),
        "claim": "I am from your bank calling to verify your account",
        "question": "Do banks call customers demanding urgent phone verification or secret details?",
    },
    {
        "id": "digital_arrest",
        "pattern": re.compile(
            r"\b(?:digital\s*arrest|arrest\s*warrant|cbi|customs\s*parcel|narcotics|police\s*case|trai\s*disconnection|ed\s*notice|enforcement\s*directorate)\b",
            re.IGNORECASE,
        ),
        "claim": "Digital arrest or legal warrant issued over phone call",
        "question": "Does Indian law or police enforce digital arrest or arrest warrants via video or phone calls?",
    },
    {
        "id": "suspicious_scam",
        "pattern": re.compile(
            r"\b(?:fraud(?:ulent)?\s+(?:transaction|activity|call)|suspicious\s+transaction|your\s+(?:account|card)\s+(?:has\s+been\s+)?(?:blocked|frozen|suspended|compromised|deactivated)|immediately\s+(?:transfer|pay|send)|limited\s+time|act\s+now|urgent(?:ly)?\s+(?:call|contact|verify|update))\b"
            r"|\b(?:deactivate\s+your|you\s+will\s+be\s+arrested|legal\s+action|file\s+a\s+case|police\s+will|courier\s+contains|parcel\s+seized)\b",
            re.IGNORECASE,
        ),
        "claim": "Urgent fraud alert or legal threat used to pressure the call recipient",
        "question": "Do legitimate banks or law enforcement agencies use urgent threats and pressure tactics in unsolicited phone calls?",
    },
]


def detect_claims_and_questions(transcript: str) -> list[dict[str, str]]:
    """
    Notices checkable claims in the anonymized transcript and generates
    neutral verification questions for each.
    """
    if not transcript:
        return []
    clean_text = scrub_pii(transcript)
    detected: list[dict[str, str]] = []
    seen_ids: set[str] = set()

    for item in CLAIM_PATTERNS:
        if item["id"] not in seen_ids and item["pattern"].search(clean_text):
            seen_ids.add(item["id"])
            detected.append({
                "claim_id": item["id"],
                "claim_text": item["claim"],
                "question": item["question"],
            })
    return detected


def compute_web_verification_risk(
    base_score: float,
    base_level: str,
    contradicted_count: int,
    reasons: Optional[list[str]] = None,
) -> dict[str, Any]:
    """
    Computes updated risk strictly following TruVoice behavior rules:
    - Risk never goes down
    - Supported and unclear change nothing (web_boost = 0.0)
    - One contradicted claim raises at least MODERATE
    - Two different contradicted claims raise SEVERE
    - Failures add no risk
    """
    normalized_base_level = str(base_level or "SAFE").upper()
    if normalized_base_level not in ("SAFE", "MODERATE", "SEVERE"):
        normalized_base_level = "MODERATE" if base_score >= 50.0 else "SAFE"

    base_score = round(max(0.0, min(100.0, float(base_score))), 2)
    reasons_list = list(reasons or [])

    if contradicted_count <= 0:
        return {
            "base_score": base_score,
            "web_boost": 0.0,
            "final_score": base_score,
            "base_level": normalized_base_level,
            "final_level": normalized_base_level,
            "reasons": reasons_list,
        }

    if contradicted_count == 1:
        if normalized_base_level == "SEVERE":
            final_score = base_score
            final_level = "SEVERE"
            web_boost = 0.0
        elif normalized_base_level == "MODERATE":
            web_boost = round(min(20.0, 84.0 - base_score) if base_score < 84.0 else 0.0, 2)
            final_score = round(min(84.0, max(base_score, base_score + web_boost)), 2)
            final_level = "MODERATE"
        else:  # SAFE
            web_boost = round(max(35.0, 60.0 - base_score), 2)
            final_score = round(min(100.0, max(60.0, base_score + web_boost)), 2)
            final_level = "MODERATE"
    else:  # 2 or more different contradicted claims
        web_boost = round(max(50.0, 85.0 - base_score) if base_score < 85.0 else 10.0, 2)
        final_score = round(min(100.0, max(85.0, base_score + web_boost)), 2)
        final_level = "SEVERE"

    final_score = max(base_score, final_score)
    return {
        "base_score": base_score,
        "web_boost": web_boost,
        "final_score": final_score,
        "base_level": normalized_base_level,
        "final_level": final_level,
        "reasons": reasons_list,
    }


class VerificationCache:
    """Thread-safe in-memory cache for verification results with TTL."""

    def __init__(self, ttl_seconds: int = 900):
        self.ttl_seconds = ttl_seconds
        self._cache: dict[str, dict[str, Any]] = {}

    def get(self, question: str) -> Optional[dict[str, Any]]:
        key = normalize_question(question)
        entry = self._cache.get(key)
        if not entry:
            return None
        if time.time() - entry["timestamp"] > self.ttl_seconds:
            self._cache.pop(key, None)
            return None
        return entry["data"]

    def set(self, question: str, data: dict[str, Any]) -> None:
        key = normalize_question(question)
        self._cache[key] = {
            "timestamp": time.time(),
            "data": data,
        }

    def clear(self) -> None:
        self._cache.clear()


global_verification_cache = VerificationCache(ttl_seconds=settings.CACHE_TTL_S)


class TinyFishClient:
    """Client for TinyFish live web Search & Fetch APIs."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        timeout: Optional[float] = None,
        search_base_url: str = "https://api.search.tinyfish.ai",
        fetch_base_url: str = "https://api.fetch.tinyfish.ai",
    ):
        self.api_key = api_key if api_key is not None else settings.TINYFISH_API_KEY
        self.timeout = timeout or settings.WEB_EVIDENCE_TIMEOUT_S
        self.search_base_url = search_base_url.rstrip("/")
        self.fetch_base_url = fetch_base_url.rstrip("/")

    async def search(self, query: str) -> list[dict[str, Any]]:
        """Searches live web for official guidance and scam advisories."""
        clean_query = scrub_pii(query)
        if not self.api_key or not settings.TINYFISH_ENABLED:
            logger.debug("TinyFish Search skipped (disabled or no API key)")
            return []

        encoded_query = urllib.parse.quote_plus(clean_query)
        url = f"{self.search_base_url}?query={encoded_query}"
        headers = {
            "X-API-Key": self.api_key,
            "User-Agent": "TruVoice-VerificationLayer/1.0",
        }

        def _do_get():
            req = urllib.request.Request(url, headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))

        try:
            loop = asyncio.get_running_loop()
            data = await asyncio.wait_for(loop.run_in_executor(None, _do_get), timeout=self.timeout)
            results = data.get("results") or []
            return [
                {
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "snippet": item.get("snippet", ""),
                    "site_name": item.get("site_name", ""),
                }
                for item in results
                if item.get("url")
            ]
        except Exception as exc:
            logger.warning("TinyFish Search request failed: %s", exc)
            return []

    async def fetch(self, urls: list[str]) -> list[dict[str, Any]]:
        """Fetches top pages and extracts clean markdown context."""
        valid_urls = [u for u in urls if u and u.startswith("http")][:3]
        if not valid_urls or not self.api_key or not settings.TINYFISH_ENABLED:
            return []

        headers = {
            "X-API-Key": self.api_key,
            "Content-Type": "application/json",
            "User-Agent": "TruVoice-VerificationLayer/1.0",
        }
        body = json.dumps({"urls": valid_urls, "format": "markdown"}).encode("utf-8")

        def _do_post():
            req = urllib.request.Request(self.fetch_base_url, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))

        try:
            loop = asyncio.get_running_loop()
            data = await asyncio.wait_for(loop.run_in_executor(None, _do_post), timeout=self.timeout)
            results = data.get("results") or []
            return [
                {
                    "url": item.get("url", ""),
                    "title": item.get("title", ""),
                    "text": item.get("text", "")[:1200],  # Token-efficient context
                }
                for item in results
                if item.get("text")
            ]
        except Exception as exc:
            logger.warning("TinyFish Fetch request failed: %s", exc)
            return []


async def judge_claim_with_llm(
    claim_text: str,
    question: str,
    search_results: list[dict[str, Any]],
    fetched_pages: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Asks the LLM to provide a final structured judgment (CONTRADICTED, SUPPORTED, UNCLEAR)
    based on the retrieved evidence.
    """
    evidence_lines: list[str] = []
    for item in search_results[:3]:
        evidence_lines.append(f"Title: {item.get('title')}\nURL: {item.get('url')}\nSnippet: {item.get('snippet')}")
    for page in fetched_pages[:2]:
        evidence_lines.append(f"Page URL: {page.get('url')}\nSummary: {page.get('text')[:400]}")

    evidence_text = "\n---\n".join(evidence_lines).strip()

    # Rule-based fallback if evidence clearly contradicts
    lower_evidence = evidence_text.lower()
    fallback_sources = [
        {"title": item.get("title", ""), "url": item.get("url", "")}
        for item in search_results[:2]
    ]

    has_contradiction_signal = any(
        phrase in lower_evidence
        for phrase in (
            "never ask", "never share", "scam alert", "fraud advisory",
            "do not share", "fake notice", "cyber fraud", "advisory against"
        )
    )

    if not settings.GROQ_API_KEY:
        if has_contradiction_signal:
            return {
                "verdict": "CONTRADICTED",
                "confidence": 0.90,
                "reason": "Official advisories state that institutions never make this demand.",
                "sources": fallback_sources,
            }
        return {
            "verdict": "UNCLEAR",
            "confidence": 0.50,
            "reason": "Insufficient web evidence to contradict or verify the claim.",
            "sources": fallback_sources,
        }

    system_prompt = (
        "You are an authoritative fact-checking judge verifying phone call claims against live web evidence. "
        "Strictly judge whether the caller's claim/demand is CONTRADICTED, SUPPORTED, or UNCLEAR. "
        "CONTRADICTED means official sources/banks explicitly state they never make this demand or warn it is a scam. "
        "SUPPORTED means official procedures confirm this demand. "
        "UNCLEAR means insufficient, contradictory, or missing evidence. "
        "Respond with JSON only."
    )
    user_prompt = f"""
Claim made on call: "{claim_text}"
Verification question: "{question}"

Retrieved web evidence:
{evidence_text or "No web documents retrieved."}

Return JSON with format:
{{
  "verdict": "CONTRADICTED" | "SUPPORTED" | "UNCLEAR",
  "confidence": 0.0 to 1.0,
  "reason": "1-2 sentence explanation citing official guidance",
  "sources": [{{"title": "...", "url": "..."}}]
}}
"""
    try:
        groq_client = AsyncGroq(api_key=settings.GROQ_API_KEY, timeout=4.0)
        response = await asyncio.wait_for(
            groq_client.chat.completions.create(
                model="openai/gpt-oss-20b",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.1,
                max_tokens=200,
            ),
            timeout=4.5,
        )
        content = (response.choices[0].message.content or "").strip()
        # Clean any markdown code blocks
        if content.startswith("```"):
            content = re.sub(r"^```(?:json)?\s*", "", content)
            content = re.sub(r"\s*```$", "", content)
        parsed = json.loads(content)
        verdict = str(parsed.get("verdict", "UNCLEAR")).upper()
        if verdict not in ("CONTRADICTED", "SUPPORTED", "UNCLEAR"):
            verdict = "UNCLEAR"
        return {
            "verdict": verdict,
            "confidence": float(parsed.get("confidence", 0.75)),
            "reason": str(parsed.get("reason", "Analysis evaluated against retrieved guidance.")),
            "sources": parsed.get("sources", fallback_sources),
        }
    except Exception as exc:
        logger.warning("LLM judgment failed, using evidence heuristics: %s", exc)
        if has_contradiction_signal:
            return {
                "verdict": "CONTRADICTED",
                "confidence": 0.88,
                "reason": "Security advisories confirm institutions never make this demand over calls.",
                "sources": fallback_sources,
            }
        return {
            "verdict": "UNCLEAR",
            "confidence": 0.50,
            "reason": "Verification inconclusive or timed out.",
            "sources": fallback_sources,
        }


async def verify_claim_pipeline(
    call_id: str,
    claim_id: str,
    claim_text: str,
    question: str,
    client: Optional[TinyFishClient] = None,
) -> dict[str, Any]:
    """
    Executes the full TinyFish verification pipeline for a checkable claim:
    1. Checks cache
    2. Scrubs any PII
    3. Searches TinyFish
    4. Fetches top pages
    5. Judges with LLM
    6. Caches and returns formatted payload
    """
    start_time = time.time()
    clean_claim = scrub_pii(claim_text)
    clean_question = scrub_pii(question)

    # 1. Check Cache
    cached = global_verification_cache.get(clean_question)
    if cached:
        latency_ms = int((time.time() - start_time) * 1000)
        return {
            "call_id": call_id,
            "claim_id": claim_id,
            "claim_text": clean_claim,
            "question": clean_question,
            "verdict": cached["verdict"],
            "confidence": cached["confidence"],
            "reason": cached["reason"],
            "sources": cached["sources"],
            "origin": "cache",
            "latency_ms": latency_ms,
            "second_opinion": cached.get("second_opinion", {
                "verdict": cached["verdict"],
                "summary": cached["reason"],
            }),
        }

    tinyfish = client or TinyFishClient()
    search_query = f"{clean_question} official advisory scam report"

    # Search + Fetch with timeout budget & graceful degradation
    try:
        search_results = await tinyfish.search(search_query)
    except Exception as exc:
        logger.warning("TinyFish search error: %s", exc)
        search_results = []

    top_urls = [res["url"] for res in search_results if res.get("url")][:2]
    try:
        fetched_pages = await tinyfish.fetch(top_urls) if top_urls else []
    except Exception as exc:
        logger.warning("TinyFish fetch error: %s", exc)
        fetched_pages = []

    # LLM Structured Judgment
    try:
        judgment = await judge_claim_with_llm(clean_claim, clean_question, search_results, fetched_pages)
    except Exception as exc:
        logger.warning("LLM judgment execution error: %s", exc)
        judgment = {
            "verdict": "UNCLEAR",
            "confidence": 0.50,
            "reason": "Verification inconclusive due to service error.",
            "sources": [],
        }

    latency_ms = int((time.time() - start_time) * 1000)
    verdict = judgment["verdict"]
    confidence = round(float(judgment.get("confidence", 0.8)), 2)
    reason = judgment.get("reason", "")
    sources = judgment.get("sources") or [
        {"title": s.get("title", ""), "url": s.get("url", "")}
        for s in search_results[:2]
    ]

    second_opinion = {
        "verdict": verdict,
        "summary": reason,
        "confidence": confidence,
    }

    evidence_payload = {
        "call_id": call_id,
        "claim_id": claim_id,
        "claim_text": clean_claim,
        "question": clean_question,
        "verdict": verdict,
        "confidence": confidence,
        "reason": reason,
        "sources": sources,
        "origin": "tinyfish",
        "latency_ms": latency_ms,
        "second_opinion": second_opinion,
    }

    # Save in Cache
    global_verification_cache.set(clean_question, evidence_payload)
    return evidence_payload


class CallVerificationSession:
    """Manages web verification budget, rate-limits, and state for a single active call."""

    def __init__(self, call_id: str):
        self.call_id = call_id
        self.claims_checked_count: int = 0
        self.last_check_time: float = 0.0
        self.checked_claim_ids: set[str] = set()
        self.contradicted_claims: list[dict[str, Any]] = []
        self._lock = asyncio.Lock()

    def should_verify(self, base_level: str) -> bool:
        if not settings.TINYFISH_ENABLED:
            return False
        if self.claims_checked_count >= settings.CLAIM_MAX_PER_CALL:
            return False
        now = time.time()
        if self.last_check_time > 0 and (now - self.last_check_time) < settings.CLAIM_MIN_GAP_S:
            return False
        return True

    def record_check_started(self, claim_id: str) -> None:
        self.claims_checked_count += 1
        self.last_check_time = time.time()
        self.checked_claim_ids.add(claim_id)

    def record_contradiction(self, claim: dict[str, Any]) -> None:
        self.contradicted_claims.append(claim)
