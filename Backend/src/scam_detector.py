import json
import logging
import os
from groq import Groq

logger = logging.getLogger(__name__)


class GroqScamDetector:
    def __init__(self, api_key: str = None):
        """
        Initializes the Groq client for Speech-to-Text and Intent Detection.
        """
        self.api_key = api_key or os.getenv("GROQ_API_KEY")
        if not self.api_key:
            raise ValueError("GROQ_API_KEY is required for GroqScamDetector.")

        self.client = Groq(api_key=self.api_key)
        self.whisper_model = "whisper-large-v3-turbo"
        self.llm_model = "openai/gpt-oss-20b"

    def _is_whisper_hallucination(self, text: str) -> bool:
        if not text:
            return True
        cleaned = text.lower().strip().strip(".!?,")
        hallucinations = {
            "thank you",
            "thank you for watching",
            "thank you for listening",
            "subtitles by amara.org",
            "subtitles by",
            "amara.org",
            "mbc news",
            "cbc news",
            "like and subscribe",
            "so",
        }
        return cleaned in hallucinations or len(cleaned) <= 1

    def transcribe_audio(self, audio_path: str) -> str:
        """
        Transcribes audio using Groq Whisper API.
        """
        try:
            with open(audio_path, "rb") as file:
                transcription = self.client.audio.transcriptions.create(
                    file=(os.path.basename(audio_path), file.read()),
                    model=self.whisper_model,
                    response_format="text",
                    language="en",
                )
            raw_text = str(transcription).strip()
            if self._is_whisper_hallucination(raw_text):
                return ""
            return raw_text
        except Exception as e:
            logger.warning(f"Error during audio transcription: {e}")
            return ""

    def analyze_scam_intent(self, transcript: str) -> dict:
        """
        Analyzes the transcript using supported Groq models to evaluate scam intent, category, and risk keywords.
        """
        if not transcript or len(transcript.strip()) < 3:
            return {
                "scam_score": 0.0,
                "category": "Insufficient Audio / Silent Call",
                "risk_keywords": [],
                "reasoning": "Audio clip too short or contains no recognizable speech.",
            }

        prompt = f"""
You are an expert Cybersecurity AI system analyzing phone call transcripts for phishing, scams, and financial fraud.

Analyze the following phone call transcript:
"{transcript}"

Provide a JSON output containing:
1. "scam_score": Float between 0.0 (100% legitimate) and 1.0 (100% scam/phishing).
2. "category": String describing the threat category (e.g., "Bank OTP Fraud", "KYC Scam", "Tech Support Fraud", "Urgent Legal Threat", "Safe Call").
3. "risk_keywords": List of suspicious words/phrases spotted in the transcript (e.g., ["OTP", "CVV", "urgent", "account blocked"]).
4. "reasoning": A concise 1-2 sentence explanation of why this was flagged or marked safe.

Return strictly valid JSON only. Do not include markdown headers or extra conversation.
JSON format:
{{
  "scam_score": 0.85,
  "category": "Bank OTP Fraud",
  "risk_keywords": ["OTP", "account suspended"],
  "reasoning": "The caller claims to be from a bank and asks for an urgent OTP."
}}
"""
        # Active Groq models list
        models_to_try = [
            self.llm_model,
            "qwen/qwen3.6-27b",
            "openai/gpt-oss-120b",
            "groq/compound-mini",
        ]
        last_error = None

        for model_name in models_to_try:
            try:
                response = self.client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {
                            "role": "system",
                            "content": "You are a JSON-only response bot for scam detection.",
                        },
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.1,
                    response_format={"type": "json_object"},
                )

                raw_content = response.choices[0].message.content.strip()
                parsed_json = json.loads(raw_content)

                return {
                    "scam_score": float(parsed_json.get("scam_score", 0.0)),
                    "category": str(parsed_json.get("category", "General Query")),
                    "risk_keywords": list(parsed_json.get("risk_keywords", [])),
                    "reasoning": str(
                        parsed_json.get("reasoning", "No suspicious activity detected.")
                    ),
                }
            except Exception as e:
                last_error = e
                logger.debug(f"LLM model {model_name} unavailable: {e}")
                continue

        # Heuristic rule-based fallback when LLM models are unavailable
        return self._heuristic_scam_analysis(transcript)

    def _heuristic_scam_analysis(self, transcript: str) -> dict:
        text_lower = transcript.lower()
        keywords_db = {
            "Bank OTP Fraud": ["otp", "one time password", "cvv", "atm pin", "bank account", "debit card", "credit card", "netbanking"],
            "KYC / Account Blocked Scam": ["kyc", "account blocked", "account suspended", "verify identity", "aadhaar", "pan card"],
            "Tech Support Fraud": ["anydesk", "teamviewer", "remote access", "virus", "compromised", "malware"],
            "Urgent Legal / Customs Threat": ["police", "customs", "cbi", "warrant", "arrest", "legal action", "court"],
            "Lottery / Prize Scam": ["winner", "lottery", "prize", "jackpot", "cash reward"],
        }

        found_keywords = []
        detected_category = "Standard Call"
        max_score = 0.1

        for category, words in keywords_db.items():
            matches = [w for w in words if w in text_lower]
            if matches:
                found_keywords.extend(matches)
                detected_category = category
                max_score = max(max_score, min(0.95, 0.4 + 0.15 * len(matches)))

        found_keywords = list(set(found_keywords))
        reasoning = (
            f"Heuristic text analysis detected suspicious keywords: {', '.join(found_keywords)}."
            if found_keywords
            else "Standard phone call transcript; no suspicious scam patterns detected."
        )

        return {
            "scam_score": round(max_score, 2),
            "category": detected_category,
            "risk_keywords": found_keywords,
            "reasoning": reasoning,
        }

    def run(self, audio_path: str) -> dict:
        transcript = self.transcribe_audio(audio_path)
        analysis = self.analyze_scam_intent(transcript)

        return {
            "transcript": transcript,
            "scam_score": analysis["scam_score"],
            "category": analysis["category"],
            "risk_keywords": analysis["risk_keywords"],
            "reasoning": analysis["reasoning"],
        }