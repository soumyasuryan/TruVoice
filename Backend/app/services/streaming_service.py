import asyncio
import base64
import datetime
import io
import logging
import os
import tempfile
import wave
import numpy as np
from app.config import settings
from app.database import get_supabase
from app.utils.pipeline import get_pipeline
from app.utils.websocket_manager import manager
from app.services.guardian_alert_service import SevereWindowGate, dispatch_guardian_alert

logger = logging.getLogger(__name__)

def mulaw_to_pcm16(mulaw_bytes: bytes) -> bytes:
    """Converts mu-law 8kHz audio bytes to 16-bit linear PCM."""
    try:
        import audioop
        return audioop.ulaw2lin(mulaw_bytes, 2)
    except Exception:
        # Fallback pure numpy implementation
        ulaw = np.frombuffer(mulaw_bytes, dtype=np.uint8)
        ulaw = ~ulaw
        sign = ulaw & 0x80
        exponent = (ulaw >> 4) & 0x07
        mantissa = ulaw & 0x0F
        sample = (mantissa << 3) + 132
        sample = sample << exponent
        sample = sample - 132
        sample = np.where(sign != 0, -sample, sample)
        return (sample * 4).astype(np.int16).tobytes()


def create_wav_bytes(pcm16_data: bytes, sample_rate: int = 8000) -> bytes:
    """Wraps raw 16-bit linear PCM audio in standard WAV container headers."""
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm16_data)
    return buf.getvalue()


class VoiceStreamSession:
    def __init__(self, call_id: str):
        self.call_id = call_id
        self.audio_buffer = bytearray()
        self.all_transcripts: list[str] = []
        self.last_analysis_time = asyncio.get_event_loop().time()
        self.chunk_duration_sec = settings.VOICE_ANALYSIS_CHUNK_SECONDS
        self._processing_lock = asyncio.Lock()
        self._guardian_alert_gate = SevereWindowGate()
        # 8000Hz * 1 byte/sample (mu-law) = 8000 bytes per second
        self.target_buffer_size = int(8000 * self.chunk_duration_sec)

    async def append_mulaw_payload(self, base64_payload: str):
        try:
            mulaw_bytes = base64.b64decode(base64_payload)
            self.audio_buffer.extend(mulaw_bytes)

            current_time = asyncio.get_event_loop().time()
            if len(self.audio_buffer) >= self.target_buffer_size and (current_time - self.last_analysis_time) >= settings.VOICE_ANALYSIS_INTERVAL_SECONDS:
                self.last_analysis_time = current_time
                # Extract chunk bytes to analyze
                chunk_mulaw = bytes(self.audio_buffer)
                # Retain last 1 second for context continuity
                self.audio_buffer = self.audio_buffer[-8000:]
                
                # Execute AI analysis asynchronously without blocking event loop
                asyncio.create_task(self.process_audio_chunk(chunk_mulaw))
        except Exception as e:
            logger.error(f"Error appending mulaw payload for call {self.call_id}: {e}")

    async def process_audio_chunk(self, mulaw_bytes: bytes):
        async with self._processing_lock:
            await self._process_audio_chunk_in_order(mulaw_bytes)

    async def _process_audio_chunk_in_order(self, mulaw_bytes: bytes):
        try:
            pcm16_bytes = mulaw_to_pcm16(mulaw_bytes)
            wav_bytes = create_wav_bytes(pcm16_bytes, sample_rate=8000)

            # Write temporary WAV file for pipeline analysis
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
                temp_file.write(wav_bytes)
                temp_path = temp_file.name

            try:
                # Offload blocking AI pipeline computation to thread pool
                loop = asyncio.get_running_loop()
                pipeline = get_pipeline()
                analysis = await loop.run_in_executor(None, pipeline.analyze_audio_sample, temp_path)
            finally:
                if os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except OSError:
                        pass

            # Calculate derived trust and scam metrics
            unified_risk = analysis.get("unified_risk_score", 0.0)
            trust_score = round(max(0.0, 100.0 - unified_risk), 2)
            scam_score = analysis.get("scam_intent_score", 0.0)
            ai_prob = analysis.get("ai_voice_probability", 0.0)
            is_scam = scam_score >= 50.0 or unified_risk >= 70.0
            is_ai_voice = ai_prob >= 60.0
            risk_level = analysis.get("risk_level", "LOW RISK")
            transcript_chunk = analysis.get("transcript", "").strip()

            if transcript_chunk and transcript_chunk not in self.all_transcripts:
                self.all_transcripts.append(transcript_chunk)

            full_transcript = " ".join(self.all_transcripts)
            keywords = analysis.get("flagged_keywords", [])
            signals = []
            if is_ai_voice:
                signals.append(f"AI Voice pattern detected ({ai_prob}%)")
            if is_scam:
                signals.append(f"Suspicious scam intent: {analysis.get('scam_category', 'Fraud')}")
            for kw in keywords:
                signals.append(f"Flagged phrase: '{kw}'")

            if not signals:
                signals.append("Normal conversation detected")

            # Structured live analysis message
            payload = {
                "type": "analysis_update",
                "call_id": self.call_id,
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "trust_score": trust_score,
                "confidence": round(min(99.0, 50.0 + len(full_transcript.split()) * 1.5), 2),
                "risk_level": risk_level,
                "threat_type": analysis.get("threat_type", "NORMAL"),
                "ui_alert": analysis.get("ui_alert", "This call looks safe."),
                "unified_risk_score": unified_risk,
                "scam_intent_score": scam_score,
                "ai_voice_probability": ai_prob,
                "is_scam": is_scam,
                "is_ai_voice": is_ai_voice,
                "transcript": full_transcript,
                "signals": signals,
                "reasoning": analysis.get("reasoning", "")
            }

            # Broadcast live analysis update to subscribers
            await manager.broadcast_to_call(self.call_id, payload)

            # Send risk alert if threat level is SEVERE or MODERATE
            if risk_level in ["SEVERE", "MODERATE"] or is_scam:
                alert_payload = {
                    "type": "risk_alert",
                    "call_id": self.call_id,
                    "risk_level": risk_level,
                    "threat_type": analysis.get("threat_type", "NORMAL"),
                    "message": analysis.get("ui_alert", f"Suspicious activity detected: {analysis.get('reasoning', 'Potential scam or phishing request.')}")
                }
                await manager.broadcast_to_call(self.call_id, alert_payload)

            if self._guardian_alert_gate.observe(risk_level):
                guardian_analysis = {
                    "risk_level": risk_level,
                    "unified_risk_score": unified_risk,
                    "scam_intent_score": scam_score,
                    "ai_voice_probability": ai_prob,
                    "scam_category": analysis.get("scam_category", "Possible scam"),
                    "threat_type": analysis.get("threat_type", "Suspicious call"),
                    "flagged_keywords": keywords,
                    "reasoning": analysis.get("reasoning", ""),
                }
                task = asyncio.create_task(
                    dispatch_guardian_alert(self.call_id, guardian_analysis)
                )
                _guardian_alert_tasks.add(task)
                task.add_done_callback(_guardian_alert_tasks.discard)

            # Update latest database record asynchronously
            await loop.run_in_executor(None, self._update_call_record_db, payload)

        except Exception as e:
            logger.error(f"Error processing audio chunk for call {self.call_id}: {e}")

    def _update_call_record_db(self, payload: dict):
        try:
            db = get_supabase()
            db.table("voice_calls").update({
                "risk_level": payload["risk_level"],
                "trust_score": payload["trust_score"],
                "confidence": payload["confidence"],
                "is_scam": payload["is_scam"],
                "is_ai_voice": payload["is_ai_voice"],
                "transcript": payload["transcript"],
                "signals": payload["signals"],
                "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
            }).eq("id", self.call_id).execute()
        except Exception as e:
            logger.error(f"Failed to update database for call {self.call_id}: {e}")


# Active sessions registry
active_stream_sessions: dict[str, VoiceStreamSession] = {}
_guardian_alert_tasks: set[asyncio.Task] = set()

def get_or_create_stream_session(call_id: str) -> VoiceStreamSession:
    if call_id not in active_stream_sessions:
        active_stream_sessions[call_id] = VoiceStreamSession(call_id)
    return active_stream_sessions[call_id]

def remove_stream_session(call_id: str):
    if call_id in active_stream_sessions:
        del active_stream_sessions[call_id]
