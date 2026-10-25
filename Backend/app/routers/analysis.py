import asyncio
import base64
import logging
import os
import shutil
import tempfile
import time
from collections import OrderedDict

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.database import get_supabase
from app.schemas import AudioAnalysisResponse, AudioBase64Request
from app.services.guardian_alert_service import SevereWindowGate, dispatch_guardian_alert
from app.utils.auth import get_current_user_id
from app.utils.pipeline import get_pipeline
from app.utils.websocket_manager import manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["Audio Analysis"])

_call_alert_gates: dict[str, SevereWindowGate] = {}
_guardian_alert_tasks: set[asyncio.Task] = set()
_call_analysis_locks: OrderedDict[str, asyncio.Lock] = OrderedDict()
_MAX_CALL_ANALYSIS_LOCKS = 256


def _get_call_analysis_lock(call_id: str) -> asyncio.Lock:
    lock = _call_analysis_locks.get(call_id)
    if lock is None:
        lock = asyncio.Lock()
        _call_analysis_locks[call_id] = lock
    _call_analysis_locks.move_to_end(call_id)
    while len(_call_analysis_locks) > _MAX_CALL_ANALYSIS_LOCKS:
        oldest_call_id, oldest_lock = next(iter(_call_analysis_locks.items()))
        if oldest_lock.locked():
            break
        _call_analysis_locks.pop(oldest_call_id)
    return lock


@router.post("/analyze", response_model=AudioAnalysisResponse)
async def analyze_audio(
    file: UploadFile = File(...),
    caller_number: str | None = Form(default=None),
    user_id: str = Depends(get_current_user_id),
):
    if not file.filename or not file.filename.lower().endswith((".wav", ".mp3", ".m4a", ".flac")):
        raise HTTPException(status_code=400, detail="Unsupported audio format. Provide WAV, MP3, M4A, or FLAC.")
    if caller_number:
        caller_number = caller_number.strip().replace(" ", "").replace("-", "")

    temp_dir = tempfile.mkdtemp()
    temp_path = os.path.join(temp_dir, os.path.basename(file.filename))
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        loop = asyncio.get_running_loop()
        pipeline = get_pipeline()
        result = await loop.run_in_executor(None, pipeline.analyze_audio_sample, temp_path)
        _save_analysis_history(user_id, caller_number, result)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Pipeline execution error: {str(exc)}") from exc
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@router.post("/analysis/audio", response_model=AudioAnalysisResponse)
async def analyze_base64_audio(
    payload: AudioBase64Request,
    user_id: str = Depends(get_current_user_id),
):
    """
    Accepts a Base64-encoded audio payload (WAV buffer captured from live call stream),
    decodes bytes, saves to a temporary WAV file, executes AI analysis pipeline,
    records history, and broadcasts real-time analysis updates if call_id is supplied.
    """
    if not payload.audio_base64:
        raise HTTPException(status_code=400, detail="audio_base64 payload is required.")

    request_started_at = time.perf_counter()
    b64_data = payload.audio_base64
    if "," in b64_data:
        b64_data = b64_data.split(",", 1)[1]

    try:
        audio_bytes = base64.b64decode(b64_data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid Base64 audio encoding.") from exc

    caller_num = payload.caller_number
    if caller_num:
        caller_num = caller_num.strip().replace(" ", "").replace("-", "")

    temp_dir = tempfile.mkdtemp()
    temp_filename = f"agora_chunk_{int(time.time() * 1000)}.wav"
    temp_path = os.path.join(temp_dir, temp_filename)

    try:
        with open(temp_path, "wb") as f:
            f.write(audio_bytes)

        loop = asyncio.get_running_loop()
        pipeline = get_pipeline()

        def emit_partial_transcript(
            transcript: str,
            confidence: float,
            quality: str,
            language: str,
            language_confidence: float,
            elapsed_sec: float,
        ) -> None:
            if not payload.call_id:
                return
            event = {
                "call_id": payload.call_id,
                "partial_transcript": transcript,
                "transcript": transcript,
                "transcript_confidence": confidence,
                "transcript_quality": quality,
                "transcript_language": language,
                "transcript_language_confidence": language_confidence,
                "time_to_first_partial_sec": elapsed_sec,
            }
            future = asyncio.run_coroutine_threadsafe(
                manager.emit_call_event(
                    payload.call_id,
                    "transcript_partial",
                    event,
                ),
                loop,
            )

            def log_emit_error(completed_future) -> None:
                try:
                    completed_future.result()
                except Exception:
                    logger.exception("Unable to emit partial transcript for call %s", payload.call_id)

            future.add_done_callback(log_emit_error)

        def emit_final_transcript(
            transcript: str,
            confidence: float,
            quality: str,
            language: str,
            language_confidence: float,
            elapsed_sec: float,
        ) -> None:
            if not payload.call_id:
                return
            event = {
                "call_id": payload.call_id,
                "type": "transcript_final",
                "final_transcript": transcript,
                "transcript_confidence": confidence,
                "transcript_quality": quality,
                "transcript_language": language,
                "transcript_language_confidence": language_confidence,
                "time_to_final_stitched_sec": elapsed_sec,
            }
            future = asyncio.run_coroutine_threadsafe(
                manager.emit_call_event(
                    payload.call_id,
                    "transcript_final",
                    event,
                ),
                loop,
            )

            def log_emit_error(completed_future) -> None:
                try:
                    completed_future.result()
                except Exception:
                    logger.exception("Unable to emit final transcript for call %s", payload.call_id)

            future.add_done_callback(log_emit_error)

        async def run_pipeline():
            if not payload.call_id:
                return await loop.run_in_executor(
                    None,
                    pipeline.analyze_audio_sample,
                    temp_path,
                )
            return await loop.run_in_executor(
                None,
                pipeline.analyze_audio_sample,
                temp_path,
                payload.call_id,
                emit_partial_transcript,
                emit_final_transcript,
            )

        if payload.call_id:
            async with _get_call_analysis_lock(payload.call_id):
                result = await run_pipeline()
        else:
            result = await run_pipeline()
        logger.info(
            "Live analysis timing call_id=%s request_to_first_score_sec=%.3f",
            payload.call_id or "non-live",
            time.perf_counter() - request_started_at,
        )
        _save_analysis_history(user_id, caller_num, result)

        if payload.call_id:
            risk_level = result.get("risk_level", "SAFE")
            trust_score = result.get(
                "trust_score",
                round(max(0.0, 100.0 - result.get("unified_risk_score", 0.0)), 1),
            )
            threat_type = result.get("threat_type", "NORMAL")
            ui_alert = result.get("ui_alert", "This call looks safe.")
            is_scam = result.get("scam_intent_score", 0.0) > 50.0
            is_ai_voice = result.get("ai_voice_probability", 0.0) > 50.0
            scam_score = result.get("scam_intent_score", 0.0)
            ai_prob = result.get("ai_voice_probability", 0.0)
            unified_risk = result.get("unified_risk_score", 0.0)
            keywords = result.get("flagged_keywords", [])

            update_payload = {
                "type": "analysis_update",
                "trust_score": trust_score,
                "confidence": 95.0,
                "risk_level": risk_level,
                "threat_type": threat_type,
                "ui_alert": ui_alert,
                "scam_category": result.get("scam_category", ""),
                "is_scam": is_scam,
                "is_ai_voice": is_ai_voice,
                "transcript": result.get(
                    "final_transcript",
                    result.get("transcript", ""),
                ),
                "partial_transcript": "",
                "final_transcript": result.get(
                    "final_transcript",
                    result.get("transcript", ""),
                ),
                "normalized_transcript": result.get("normalized_transcript", ""),
                "transcript_confidence": result.get("transcript_confidence", 0.0),
                "transcript_quality": result.get("transcript_quality", "unknown"),
                "transcript_language": result.get("transcript_language", "unknown"),
                "transcript_language_confidence": result.get(
                    "transcript_language_confidence", 0.0
                ),
                "time_to_first_partial_sec": result.get("time_to_first_partial_sec"),
                "time_to_final_stitched_sec": result.get("time_to_final_stitched_sec"),
                "time_to_first_score_sec": result.get("time_to_first_score_sec"),
                "signals": keywords,
                "reasoning": result.get("reasoning", ""),
                "ai_voice_probability": ai_prob,
                "scam_intent_score": scam_score,
                "unified_risk_score": unified_risk,
            }
            await manager.broadcast_to_call(payload.call_id, update_payload)

            if risk_level in ["SEVERE", "MODERATE"] or is_scam:
                alert_payload = {
                    "type": "risk_alert",
                    "call_id": payload.call_id,
                    "risk_level": risk_level,
                    "threat_type": threat_type,
                    "message": ui_alert,
                }
                await manager.broadcast_to_call(payload.call_id, alert_payload)

            if payload.call_id not in _call_alert_gates:
                _call_alert_gates[payload.call_id] = SevereWindowGate()
            gate = _call_alert_gates[payload.call_id]

            if gate.observe(risk_level):
                guardian_analysis = {
                    "risk_level": risk_level,
                    "unified_risk_score": unified_risk,
                    "scam_intent_score": scam_score,
                    "ai_voice_probability": ai_prob,
                    "scam_category": result.get("scam_category", "Possible scam"),
                    "threat_type": threat_type,
                    "flagged_keywords": keywords,
                    "reasoning": result.get("reasoning", ""),
                }
                task = asyncio.create_task(
                    dispatch_guardian_alert(payload.call_id, guardian_analysis)
                )
                _guardian_alert_tasks.add(task)
                task.add_done_callback(_guardian_alert_tasks.discard)

            await loop.run_in_executor(
                None, _update_voice_call_record, payload.call_id, update_payload
            )

        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Base64 pipeline execution error: {str(exc)}") from exc
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)



@router.get("/analysis-history")
def get_analysis_history(user_id: str = Depends(get_current_user_id)):
    result = (
        get_supabase()
        .table("call_analysis_history")
        .select("id,caller_number,file_name,transcript,ai_voice_probability,scam_intent_score,unified_risk_score,risk_level,scam_category,flagged_keywords,reasoning,created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(30)
        .execute()
    )
    return {"items": result.data or []}


def _save_analysis_history(user_id: str, caller_number: str | None, result: dict) -> None:
    try:
        db = get_supabase()
        db.table("call_analysis_history").insert(
            {
                "user_id": user_id,
                "caller_number": caller_number,
                "file_name": result["file_name"],
                "transcript": result["transcript"],
                "ai_voice_probability": result["ai_voice_probability"],
                "scam_intent_score": result["scam_intent_score"],
                "unified_risk_score": result["unified_risk_score"],
                "risk_level": result["risk_level"],
                "scam_category": result["scam_category"],
                "flagged_keywords": result["flagged_keywords"],
                "reasoning": result["reasoning"],
            }
        ).execute()
    except Exception as exc:
        logger.warning(f"Could not save call analysis history to database: {exc}")


def _update_voice_call_record(call_id: str, payload: dict) -> None:
    try:
        db = get_supabase()
        db.table("voice_calls").update({
            "risk_level": payload["risk_level"],
            "trust_score": payload["trust_score"],
            "confidence": payload["confidence"],
            "is_scam": payload["is_scam"],
            "is_ai_voice": payload["is_ai_voice"],
            "threat_type": payload.get("threat_type", "NORMAL"),
            "scam_category": payload.get("scam_category", ""),
            "ui_alert": payload.get("ui_alert", "This call looks safe."),
            "signals": payload.get("signals", []),
            "reasoning": payload.get("reasoning", ""),
        }).eq("id", call_id).execute()
    except Exception as exc:
        logger.warning(f"Could not update voice_calls record: {exc}")
