import datetime
import json
import logging
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status, WebSocket, WebSocketDisconnect
from jose import JWTError, jwt
from app.config import settings
from app.database import get_supabase
from app.schemas import (
    AgoraTokenRequest,
    AgoraTokenResponse,
    LogCallRequest,
    LogCallResponse,
    UpdateCallStatusRequest,
    VoiceCallResponse,
)
from app.services.agora_service import generate_rtc_token, _compute_uid
from app.services.streaming_service import (
    get_or_create_stream_session,
    remove_stream_session,
)
from app.utils.auth import get_current_user_id
from app.utils.websocket_manager import manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/voice", tags=["Voice Calling & Telephony"])


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime.datetime]:
    if not value:
        return None
    try:
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


@router.post("/token", response_model=AgoraTokenResponse)
def get_voice_agora_token(
    payload: AgoraTokenRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Generates an Agora RTC token for the authenticated user to join a specified voice call channel.
    """
    uid_value = _compute_uid(user_id)
    if not settings.AGORA_APP_ID or not settings.AGORA_APP_CERTIFICATE:
        logger.warning(
            f"[TOKEN] AGORA credentials missing — returning FAKE dev token for user={user_id[:8]}. "
            f"APP_ID set={bool(settings.AGORA_APP_ID)}, CERTIFICATE set={bool(settings.AGORA_APP_CERTIFICATE)}. "
            f"Agora media will NOT work between peers."
        )
        return AgoraTokenResponse(
            token=f"demo_agora_rtc_token_{user_id}_{payload.channelName}",
            channelName=payload.channelName,
            user_id=user_id,
            uid=uid_value,
        )

    try:
        token = generate_rtc_token(payload.channelName, user_id)
        is_real_token = token.startswith("007") or token.startswith("006")
        logger.info(
            f"[TOKEN] {'REAL Agora token' if is_real_token else 'FAKE dev token (token generation failed!)'} "
            f"generated for user={user_id[:8]}, uid={uid_value}, channel={payload.channelName}, "
            f"appId={settings.AGORA_APP_ID[:8]}..."
        )
        return AgoraTokenResponse(
            token=token,
            channelName=payload.channelName,
            user_id=user_id,
            uid=uid_value,
        )
    except Exception as e:
        logger.error(f"Error generating Agora token: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate Agora token.")



@router.post("/log-call", response_model=LogCallResponse)
async def log_outgoing_call(
    payload: LogCallRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Logs an app-to-app call initiation in the voice_calls database table and dispatches real-time signaling to target user.
    """
    db = get_supabase()

    # Validate whether targetUserId is a valid UUID or a phone number string
    target_user_uuid = None
    phone_number_val = (
        payload.targetPhoneNumber.strip().replace(" ", "").replace("-", "")
        if payload.targetPhoneNumber
        else "app-to-app"
    )

    if payload.targetUserId:
        try:
            val = uuid.UUID(payload.targetUserId)
            target_user_uuid = str(val)
        except ValueError:
            if not payload.targetPhoneNumber:
                phone_number_val = payload.targetUserId.strip().replace(" ", "").replace("-", "")
            try:
                found_user = db.table("users").select("id").or_(
                    f"phone_number.eq.{phone_number_val},email.eq.{payload.targetUserId}"
                ).execute()
                if found_user.data:
                    target_user_uuid = str(found_user.data[0]["id"])
            except Exception as e:
                logger.warning(f"Error resolving target user UUID: {e}")

    if not target_user_uuid:
        raise HTTPException(
            status_code=400,
            detail="Voice calls can only be placed to a registered TruVoice user. Add a valid user id or phone number from the app user list.",
        )

    # Create initial database record for the call
    call_record = db.table("voice_calls").insert({
        "user_id": user_id,
        "target_user_id": target_user_uuid,
        "channel_name": payload.channelName,
        "phone_number": phone_number_val,
        "status": "initiated",
        "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }).execute()

    if not call_record.data:
        raise HTTPException(status_code=500, detail="Failed to create voice call record.")

    call_id = str(call_record.data[0]["id"])

    # If target is a registered app user, dispatch real-time incoming call signal
    if target_user_uuid:
        caller_name = "TruVoice User"
        try:
            caller_user = db.table("users").select("name").eq("id", user_id).execute()
            if caller_user.data and caller_user.data[0].get("name"):
                caller_name = caller_user.data[0]["name"]
        except Exception:
            pass

        await manager.send_to_user(target_user_uuid, {
            "type": "incoming_call",
            "callId": call_id,
            "channelName": payload.channelName,
            "callerUserId": user_id,
            "callerName": caller_name,
        })

    return LogCallResponse(
        call_id=call_id,
        channel_name=payload.channelName,
        status="initiated",
    )


@router.post("/update-call")
async def update_call_status(
    payload: UpdateCallStatusRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Updates call status (e.g. answered, ended, no-answer, declined, busy) and duration.
    """
    db = get_supabase()
    existing = db.table("voice_calls").select("id,user_id,target_user_id,channel_name").eq("id", payload.call_id).execute()

    if not existing.data:
        raise HTTPException(status_code=404, detail="Call record not found.")

    record = existing.data[0]
    if str(record["user_id"]) != user_id and str(record.get("target_user_id")) != user_id:
        if record.get("target_user_id") is None:
            # Auto-assign target_user_id to user_id (the answering callee)
            db.table("voice_calls").update({"target_user_id": user_id}).eq("id", payload.call_id).execute()
            record["target_user_id"] = user_id
        else:
            raise HTTPException(status_code=403, detail="Unauthorized to update this call record.")

    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    update_data = {
        "status": payload.status,
        "updated_at": now_iso,
    }

    if payload.status == "answered":
        update_data["answered_at"] = now_iso
    elif payload.status in ["ended", "completed", "no-answer", "no_answer", "missed", "declined", "busy", "canceled"]:
        update_data["ended_at"] = now_iso
        if payload.duration > 0:
            update_data["duration"] = payload.duration

        # Broadcast call_ended to WebSocket subscribers
        await manager.broadcast_to_call(payload.call_id, {
            "type": "call_ended",
            "call_id": payload.call_id,
            "status": payload.status,
        })

    db.table("voice_calls").update(update_data).eq("id", payload.call_id).execute()

    # Dispatch signaling update to both caller and target callee
    target_id = record.get("target_user_id")
    resp_msg = {
        "type": "call_response",
        "callId": payload.call_id,
        "action": payload.status,
        "channelName": record.get("channel_name", ""),
    }
    await manager.send_to_user(str(record["user_id"]), resp_msg)
    if target_id:
        await manager.send_to_user(str(target_id), resp_msg)

    return {"message": "Call record updated successfully.", "call_id": payload.call_id, "status": payload.status}


@router.get("/pending-call")
def get_pending_incoming_call(user_id: str = Depends(get_current_user_id)):
    """
    Checks if there is an active initiated incoming call for the authenticated user.
    Auto-expires any pending calls older than 45 seconds.
    """
    db = get_supabase()
    pending = db.table("voice_calls").select("*").eq("target_user_id", user_id).eq("status", "initiated").order("created_at", desc=True).execute()
    if pending.data:
        now = datetime.datetime.now(datetime.timezone.utc)
        for rec in pending.data:
            created_str = rec.get("started_at") or rec.get("created_at")
            is_expired = False
            if created_str:
                try:
                    created_time = datetime.datetime.fromisoformat(created_str.replace("Z", "+00:00"))
                    if (now - created_time).total_seconds() > 45:
                        is_expired = True
                except Exception as e:
                    logger.warning(f"Error parsing pending call timestamp for call {rec.get('id')}: {e}")

            if is_expired:
                # Auto-expire stale initiated record in database
                try:
                        db.table("voice_calls").update({"status": "no-answer", "updated_at": now.isoformat(), "ended_at": now.isoformat()}).eq("id", rec["id"]).execute()
                except Exception as ex:
                    logger.warning(f"Failed to auto-cancel expired call {rec.get('id')}: {ex}")
                continue

            caller_name = "TruVoice User"
            try:
                c = db.table("users").select("name").eq("id", rec["user_id"]).execute()
                if c.data and c.data[0].get("name"):
                    caller_name = c.data[0]["name"]
            except Exception:
                pass
            return {
                "has_pending": True,
                "callId": rec["id"],
                "channelName": rec.get("channel_name"),
                "callerUserId": rec["user_id"],
                "callerName": caller_name,
            }
    return {"has_pending": False}



@router.get("/users")
def list_app_users(user_id: str = Depends(get_current_user_id)):
    """
    Returns registered application users for user discovery and app-to-app calling.
    """
    db = get_supabase()
    users = db.table("users").select("id,name,email,phone_number,created_at").neq("id", user_id).execute()
    return {"users": users.data or []}


@router.get("/calls", response_model=dict)
def list_user_voice_calls(user_id: str = Depends(get_current_user_id)):
    """
    Fetches call history where authenticated user is caller or target callee.
    """
    db = get_supabase()
    caller_calls = db.table("voice_calls").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(30).execute()
    callee_calls = db.table("voice_calls").select("*").eq("target_user_id", user_id).order("created_at", desc=True).limit(30).execute()

    items_map = {}
    for item in (caller_calls.data or []) + (callee_calls.data or []):
        items_map[item["id"]] = item

    combined_items = sorted(items_map.values(), key=lambda x: x.get("created_at", ""), reverse=True)
    enriched_items = []
    for item in combined_items:
        participant_id = (
            item.get("target_user_id")
            if str(item.get("user_id")) == str(user_id)
            else item.get("user_id")
        )
        participant = None
        if participant_id:
            participant_result = (
                db.table("users")
                .select("name,phone_number")
                .eq("id", participant_id)
                .limit(1)
                .execute()
            )
            participant = participant_result.data[0] if participant_result.data else None

        enriched_item = dict(item)
        if participant:
            enriched_item["target_user_name"] = participant.get("name")
            enriched_item["caller_name"] = participant.get("name")
            enriched_item["caller_number"] = participant.get("phone_number")
            enriched_item["phone_number"] = participant.get("phone_number")
        enriched_items.append(enriched_item)

    return {"items": enriched_items}


@router.get("/calls/{call_id}")
def get_voice_call_detail(call_id: str, user_id: str = Depends(get_current_user_id)):
    """
    Fetches details for a specific call. Enforces user ownership (caller or target user).
    """
    db = get_supabase()
    result = db.table("voice_calls").select("*").eq("id", call_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Call record not found.")

    record = result.data[0]
    if str(record["user_id"]) != user_id and str(record.get("target_user_id")) != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized access to this call record.")

    return record


# WebSocket Router Setup
ws_router = APIRouter(tags=["WebSockets"])

@ws_router.websocket("/ws/live-analysis/{call_id}")
async def handle_live_analysis_ws(websocket: WebSocket, call_id: str, token: str = Query(...)):
    """
    WebSocket endpoint for mobile clients to receive real-time AI scam analysis updates during an Agora call.
    Validates JWT token and verifies caller or callee ownership of call_id.
    """
    # 1. Authenticate user JWT
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except JWTError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # 2. Verify call ownership in database (caller or callee)
    db = get_supabase()
    call_record = db.table("voice_calls").select("user_id,target_user_id").eq("id", call_id).execute()
    if not call_record.data:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    rec = call_record.data[0]
    if str(rec["user_id"]) != str(user_id) and str(rec.get("target_user_id")) != str(user_id):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # 3. Connect subscriber
    await manager.connect_analysis(call_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        await manager.disconnect_analysis(call_id, websocket)
    except Exception as e:
        logger.error(f"Error in live analysis WS for call {call_id}: {e}")
        await manager.disconnect_analysis(call_id, websocket)


@ws_router.websocket("/ws/signaling")
async def handle_user_signaling_ws(websocket: WebSocket, token: str = Query(...)):
    """
    WebSocket endpoint for user call signaling (incoming call alerts & call responses).
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except JWTError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect_user(user_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
                continue

            try:
                message = json.loads(data)
                if message.get("type") == "update_call_status":
                    payload_data = message.get("payload")
                    if not payload_data:
                        continue
                    
                    try:
                        payload = UpdateCallStatusRequest(**payload_data)
                    except Exception:
                        await websocket.send_json({"type": "error", "message": "Invalid payload for update_call_status."})
                        continue

                    db = get_supabase()
                    existing = db.table("voice_calls").select("id,user_id,target_user_id,channel_name").eq("id", payload.call_id).execute()

                    if not existing.data:
                        await websocket.send_json({"type": "error", "message": "Call not found."})
                        continue

                    record = existing.data[0]
                    if str(record["user_id"]) != user_id and str(record.get("target_user_id")) != user_id:
                        if record.get("target_user_id") is None:
                            # Auto-assign target_user_id to user_id (the answering callee)
                            db.table("voice_calls").update({"target_user_id": user_id}).eq("id", payload.call_id).execute()
                            record["target_user_id"] = user_id
                        else:
                            await websocket.send_json({"type": "error", "message": "Unauthorized."})
                            continue

                    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
                    update_data = {
                        "status": payload.status,
                        "updated_at": now_iso,
                    }

                    if payload.status == "answered":
                        update_data["answered_at"] = now_iso
                    elif payload.status in ["ended", "completed", "no-answer", "no_answer", "missed", "declined", "busy", "canceled"]:
                        update_data["ended_at"] = now_iso
                        if payload.duration > 0:
                            update_data["duration"] = payload.duration

                        await manager.broadcast_to_call(payload.call_id, {
                            "type": "call_ended",
                            "call_id": payload.call_id,
                            "status": payload.status,
                        })

                    db.table("voice_calls").update(update_data).eq("id", payload.call_id).execute()

                    target_id = record.get("target_user_id")
                    resp_msg = {
                        "type": "call_response",
                        "callId": payload.call_id,
                        "action": payload.status,
                        "channelName": record.get("channel_name", ""),
                    }
                    await manager.send_to_user(str(record["user_id"]), resp_msg)
                    if target_id:
                        await manager.send_to_user(str(target_id), resp_msg)
                    
                    await websocket.send_json({"type": "update_call_status_success", "call_id": payload.call_id, "status": payload.status})

            except (json.JSONDecodeError, KeyError):
                logger.warning(f"Invalid WebSocket message from user {user_id}: {data}")

    except WebSocketDisconnect:
        await manager.disconnect_user(user_id, websocket)
    except Exception as e:
        logger.error(f"Error in user signaling WS for user {user_id}: {e}")
        await manager.disconnect_user(user_id, websocket)