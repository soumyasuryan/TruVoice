import math
import re
from typing import Any, Callable

import numpy as np


TARGET_SAMPLE_RATE = 16_000
_WHITESPACE = re.compile(r"\s+")
_WORD = re.compile(r"(?<!\w)([\w]+)(?!\w)", re.UNICODE)
_DEVANAGARI = re.compile(r"[\u0900-\u097f]")
_ROMAN_HINDI_WORDS = frozenset(
    """
    aap aapka aapki aapke apka apki apke batao bataye bhejo bhejiye chahiye
    diya diye gaya gaye hai hain ho hoga hogaya karke karna karo karlo liye
    ke ki ko kyun le lena lijiye mera meri mere mujhe nahi nahi na
    par paise paisa paanch panch raha rahi rahe raha rupees rupaye
    sabhi sirf teen tha thi toh tum tumhara tumhare tumhari turant
    unka unki uska uski wala wali wale wapas yeh ye yeh
    """
    .split()
)
_ENGLISH_CONTEXT_WORDS = frozenset(
    """
    account blocked bank card accountnumber transfer share send verify
    verification password details money payment security urgently click
    link your please number otp kyc upi rbi sbi hdfc icici
    """
    .split()
)
_DOMAIN_TERMS = {
    "otp": ("one time password", "o t p", "o.t.p", "ओटीपी"),
    "KYC": ("k y c", "k.y.c", "केवाईसी"),
    "PIN": ("p i n", "p.i.n"),
    "UPI": ("u p i", "u.p.i", "you pi ai", "you pee eye", "यूपीआई"),
    "RBI": ("r b i", "r.b.i", "आरबीआई"),
    "SBI": ("s b i", "s.b.i", "एसबीआई"),
    "HDFC": ("h d f c", "h.d.f.c", "एचडीएफसी"),
    "ICICI": ("i c i c i", "i.c.i.c.i", "आईसीआईसीआई"),
}
_TERM_ALIASES = {
    alias: canonical
    for canonical, aliases in _DOMAIN_TERMS.items()
    for alias in (*aliases, canonical.lower())
}
_TERM_PATTERN = re.compile(
    r"(?<!\w)("
    + "|".join(
        re.escape(alias)
        for alias in sorted(_TERM_ALIASES, key=len, reverse=True)
    )
    + r")(?!\w)",
    re.IGNORECASE,
)
_PHRASE_NORMALIZATIONS = (
    (re.compile(r"\baccount\s+(?:is\s+)?block\b", re.IGNORECASE), "account blocked"),
    (re.compile(r"\bverfication\b", re.IGNORECASE), "verification"),
)
_ENGLISH_NUMBERS = {
    "zero": "0",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
    "ten": "10",
    "eleven": "11",
    "twelve": "12",
    "thirteen": "13",
    "fourteen": "14",
    "fifteen": "15",
    "sixteen": "16",
    "seventeen": "17",
    "eighteen": "18",
    "nineteen": "19",
    "twenty": "20",
}
_HINDI_NUMBERS = {
    "ek": "1",
    "एक": "1",
    "दो": "2",
    "तीन": "3",
    "चार": "4",
    "पांच": "5",
    "पाँच": "5",
    "छह": "6",
    "छः": "6",
    "सात": "7",
    "आठ": "8",
    "नौ": "9",
    "दस": "10",
    "ग्यारह": "11",
    "बारह": "12",
    "तेरह": "13",
    "चौदह": "14",
    "पंद्रह": "15",
    "सोलह": "16",
    "सत्रह": "17",
    "अठारह": "18",
    "उन्नीस": "19",
    "बीस": "20",
    "teen": "3",
    "tin": "3",
    "char": "4",
    "chaar": "4",
    "panch": "5",
    "paanch": "5",
    "chhe": "6",
    "cheh": "6",
    "saat": "7",
    "aath": "8",
    "nau": "9",
    "das": "10",
    "gyarah": "11",
    "barah": "12",
    "terah": "13",
    "chaudah": "14",
    "pandrah": "15",
    "solah": "16",
    "satrah": "17",
    "atharah": "18",
    "unnis": "19",
    "bees": "20",
    "०": "0",
    "१": "1",
    "२": "2",
    "३": "3",
    "४": "4",
    "५": "5",
    "६": "6",
    "७": "7",
    "८": "8",
    "९": "9",
}
_NUMBER_PATTERN = re.compile(
    r"(?<!\w)("
    + "|".join(
        re.escape(token)
        for token in sorted(
            (*_ENGLISH_NUMBERS, *_HINDI_NUMBERS),
            key=len,
            reverse=True,
        )
    )
    + r")(?!\w)",
    re.IGNORECASE,
)
_SCAM_DOMAIN_LEXICON = (
    "OTP, one time password, KYC, PIN, UPI, RBI, SBI, HDFC, ICICI, "
    "account blocked, verification, bank account, debit card, credit card, "
    "CVV, Aadhaar, PAN, net banking, transfer, refund, remote access"
)


def preprocess_audio(audio_path: str) -> Any:
    """Decode/resample input once into mono float32 audio at 16 kHz."""
    from faster_whisper.audio import decode_audio

    return decode_audio(audio_path, sampling_rate=TARGET_SAMPLE_RATE)


def normalize_transcript(text: str) -> str:
    return _WHITESPACE.sub(" ", str(text or "")).strip()


def detect_transcript_language(text: str) -> tuple[str, float]:
    """Heuristically classify an utterance without translating its words."""
    normalized = normalize_transcript(text)
    tokens = [token.casefold() for token in _WORD.findall(normalized)]
    if not tokens:
        return "unknown", 0.0

    devanagari_count = len(_DEVANAGARI.findall(normalized))
    latin_tokens = [token for token in tokens if token.isascii() and token.isalpha()]
    hindi_indicators = sum(token in _ROMAN_HINDI_WORDS for token in latin_tokens)
    english_indicators = sum(token in _ENGLISH_CONTEXT_WORDS for token in latin_tokens)

    if devanagari_count:
        latin_speech_tokens = [
            token
            for token in latin_tokens
            if token not in {"otp", "kyc", "pin", "upi", "rbi", "sbi", "hdfc", "icici"}
        ]
        if hindi_indicators or english_indicators or latin_speech_tokens:
            return "hinglish", 0.9
        return "hindi", 0.95

    if hindi_indicators and english_indicators:
        confidence = min(
            0.98,
            0.65 + min(hindi_indicators, english_indicators) * 0.08,
        )
        return "hinglish", confidence
    if hindi_indicators:
        return "hindi", min(0.95, 0.65 + hindi_indicators * 0.05)
    if english_indicators:
        return "english", min(0.95, 0.65 + english_indicators * 0.04)
    return "english", 0.5


def get_hinglish_asr_prompt(previous_context: str | None = None) -> str:
    """Provide local decode hints; hints bias spelling but never translate."""
    context = normalize_transcript(previous_context or "")
    prompt = f"Common Indian banking terms: {_SCAM_DOMAIN_LEXICON}."
    if context:
        prompt = f"{prompt} Recent caller wording: {' '.join(context.split()[-64:])}"
    return prompt


def normalize_hinglish_transcript(
    text: str,
    language: str | None = None,
) -> str:
    """Stabilize vocabulary and punctuation while preserving the spoken language."""
    normalized = normalize_transcript(text)
    if not normalized:
        return ""

    detected_language = language or detect_transcript_language(normalized)[0]

    def normalize_term(match: re.Match[str]) -> str:
        canonical = _TERM_ALIASES[match.group(0).casefold()]
        if canonical == "otp":
            return "OTP"
        return canonical

    normalized = _TERM_PATTERN.sub(normalize_term, normalized)
    for pattern, replacement in _PHRASE_NORMALIZATIONS:
        normalized = pattern.sub(replacement, normalized)

    def normalize_number(match: re.Match[str]) -> str:
        token = match.group(0).casefold()
        if token in _ENGLISH_NUMBERS:
            return _ENGLISH_NUMBERS[token]
        if token in _HINDI_NUMBERS and detected_language in {"hindi", "hinglish"}:
            return _HINDI_NUMBERS[token]
        return match.group(0)

    normalized = _NUMBER_PATTERN.sub(normalize_number, normalized)
    if detected_language in {"hindi", "hinglish"}:
        normalized = re.sub(
            r"(?<!\w)do(?=\s+(?:otp|kyc|pin|upi|account|bank|baar|bar|rupees|rupaye)\b)",
            "2",
            normalized,
            flags=re.IGNORECASE,
        )
    normalized = re.sub(r"\s+([,.;:!?।])", r"\1", normalized)
    normalized = re.sub(r"([,.;:!?।])(?=[^\s.,;:!?।])", r"\1 ", normalized)
    normalized = _WHITESPACE.sub(" ", normalized).strip()
    return normalized


def normalize_and_detect_language(text: str) -> tuple[str, str, float]:
    language, confidence = detect_transcript_language(text)
    return normalize_hinglish_transcript(text, language), language, confidence


def _normalized_token(token: str) -> str:
    return "".join(character for character in token.casefold() if character.isalnum())


def stitch_transcripts(previous: str, current: str, max_overlap_words: int = 40) -> str:
    """Join successive ASR chunks while removing a repeated word overlap."""
    previous = normalize_transcript(previous)
    current = normalize_transcript(current)
    if not previous:
        return current
    if not current:
        return previous

    previous_tokens = previous.split()
    current_tokens = current.split()
    previous_words = [
        (index, normalized)
        for index, token in enumerate(previous_tokens)
        if (normalized := _normalized_token(token))
    ]
    current_words = [
        (index, normalized)
        for index, token in enumerate(current_tokens)
        if (normalized := _normalized_token(token))
    ]

    max_overlap = min(max_overlap_words, len(previous_words), len(current_words))
    overlap = 0
    for size in range(max_overlap, 0, -1):
        if [word for _, word in previous_words[-size:]] == [
            word for _, word in current_words[:size]
        ]:
            overlap = size
            break

    if overlap:
        consumed_token_index = current_words[overlap - 1][0] + 1
        remainder = " ".join(current_tokens[consumed_token_index:])
    else:
        remainder = current

    if not remainder:
        return previous
    if previous.endswith("-"):
        return normalize_transcript(previous[:-1] + remainder)
    return f"{previous} {remainder}"


def has_speech_energy(audio: np.ndarray, min_rms: float) -> bool:
    if audio.size == 0:
        return False
    rms = float(np.sqrt(np.mean(np.square(audio))))
    return math.isfinite(rms) and rms >= min_rms


def estimate_transcript_confidence(
    segments: list[Any],
    language_probability: float | None = None,
) -> float:
    """Return a bounded heuristic confidence from Whisper segment metadata."""
    if not segments:
        return 0.0

    weighted_score = 0.0
    total_weight = 0.0
    for segment in segments:
        text_weight = max(1, len(str(getattr(segment, "text", "")).split()))
        avg_logprob = float(getattr(segment, "avg_logprob", -1.0))
        no_speech_probability = float(getattr(segment, "no_speech_prob", 0.0))
        segment_score = math.exp(min(0.0, max(-10.0, avg_logprob)))
        segment_score *= 1.0 - min(1.0, max(0.0, no_speech_probability))
        weighted_score += segment_score * text_weight
        total_weight += text_weight

    confidence = weighted_score / total_weight
    if language_probability is not None:
        confidence *= 0.5 + 0.5 * min(1.0, max(0.0, language_probability))
    return round(min(1.0, max(0.0, confidence)), 4)


def transcript_quality(confidence: float, has_speech: bool) -> str:
    if not has_speech:
        return "no_speech"
    if confidence >= 0.75:
        return "high"
    if confidence >= 0.45:
        return "medium"
    return "low"


def transcribe_audio(
    model: Any,
    audio: np.ndarray,
    *,
    beam_size: int,
    language: str | None,
    min_rms: float,
    min_silence_duration_ms: int,
    initial_prompt: str | None = None,
    multilingual: bool = True,
    on_segment: Callable[[list[Any], float], None] | None = None,
) -> tuple[list[Any], Any, float, bool]:
    """Apply an RMS pre-gate and faster-whisper VAD before ASR decoding."""
    if not has_speech_energy(audio, min_rms):
        return [], None, 0.0, False

    segments_iterator, info = model.transcribe(
        audio,
        beam_size=beam_size,
        language=language,
        multilingual=multilingual,
        condition_on_previous_text=True,
        initial_prompt=initial_prompt,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": min_silence_duration_ms},
    )
    language_probability = getattr(info, "language_probability", None)
    segments = []
    confidence = 0.0
    for segment in segments_iterator:
        segments.append(segment)
        confidence = estimate_transcript_confidence(segments, language_probability)
        if on_segment:
            on_segment(segments, confidence)
    return segments, info, confidence, bool(segments)
