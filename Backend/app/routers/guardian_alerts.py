import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse

from app.config import settings
from app.database import get_supabase
from app.schemas import ElderlyModeUpdate, GuardianContactCreate
from app.services.guardian_alert_service import (
    MAX_CONTACTS,
    create_unsubscribe_token,
    hash_verification_token,
    is_contact_limit_error,
    is_unique_violation,
)
from app.utils.auth import get_current_user_id
from app.utils.otp import send_email

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/guardian-alerts", tags=["Guardian Alerts"])
VERIFICATION_LIFETIME = timedelta(hours=24)


def _send_guardian_added_alert(email: str, contact_id: str, verified_at: str) -> None:
    unsubscribe_token = create_unsubscribe_token(contact_id, verified_at)
    unsubscribe_url = (
        f"{settings.PUBLIC_SERVER_URL.rstrip('/')}/api/v1/guardian-alerts/"
        f"unsubscribe/{contact_id}?token={unsubscribe_token}"
    )
    subject = "TruVoice Alert: Added as trusted guardian contact"
    text_body = (
        "TruVoice Guardian Alert Notification\n\n"
        "You have been added as a trusted guardian contact on TruVoice.\n\n"
        "Elderly mode is active for this account. No email verification is required — "
        "you will automatically receive urgent security alert notifications if severe scam activity "
        "or fraudulent threats are detected during calls.\n\n"
        "To stop receiving guardian alerts, you can unsubscribe at any time:\n"
        f"{unsubscribe_url}\n"
    )
    html_body = (
        "<h2>TruVoice Guardian Alert Notification</h2>"
        "<p>You have been added as a trusted guardian contact on <strong>TruVoice</strong>.</p>"
        "<p>Elderly mode is active for this account. <strong>No verification is required</strong> &mdash; "
        "you will automatically receive urgent security alert notifications if severe scam activity "
        "or fraudulent threats are detected during calls.</p>"
        f'<p><a href="{unsubscribe_url}">Unsubscribe from guardian alerts</a></p>'
    )
    send_email(email, subject, text_body, html_body)


def _verification_email(email: str, token: str) -> None:
    verify_url = (
        f"{settings.PUBLIC_SERVER_URL.rstrip('/')}/api/v1/guardian-alerts/"
        f"contacts/verify?token={token}"
    )
    send_email(
        email,
        "Verify your TruVoice guardian contact",
        (
            "A TruVoice user added this address as a guardian contact. "
            f"Verify this address within 24 hours: {verify_url}\n"
            "If you did not expect this email, you can ignore it."
        ),
        (
            "<p>A TruVoice user added this address as a guardian contact.</p>"
            f'<p><a href="{verify_url}">Verify this email address</a></p>'
            "<p>This link expires in 24 hours. If you did not expect this email, ignore it.</p>"
        ),
    )


def _raise_contact_write_error(exc: Exception) -> None:
    if is_contact_limit_error(exc):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You can add up to {MAX_CONTACTS} guardian contacts.",
        ) from exc
    if is_unique_violation(exc):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This email address is already on your guardian contact list.",
        ) from exc
    logger.exception("Guardian contact update failed")
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Unable to save this guardian contact.",
    ) from exc


@router.get("/settings")
def get_guardian_settings(user_id: str = Depends(get_current_user_id)):
    result = (
        get_supabase()
        .table("users")
        .select("elderly_mode_enabled")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="User account was not found.")
    return {"enabled": bool(result.data[0].get("elderly_mode_enabled", False))}


@router.put("/settings")
def update_guardian_settings(
    payload: ElderlyModeUpdate,
    user_id: str = Depends(get_current_user_id),
):
    result = (
        get_supabase()
        .table("users")
        .update({"elderly_mode_enabled": payload.enabled})
        .eq("id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="User account was not found.")
    return {"enabled": payload.enabled}


@router.get("/contacts")
def list_guardian_contacts(user_id: str = Depends(get_current_user_id)):
    result = (
        get_supabase()
        .table("guardian_contacts")
        .select("id,email,status,created_at,verified_at")
        .eq("user_id", user_id)
        .eq("is_active", True)
        .order("created_at")
        .execute()
    )
    return {"contacts": result.data or [], "limit": MAX_CONTACTS}


@router.post("/contacts", status_code=status.HTTP_201_CREATED)
def add_guardian_contact(
    payload: GuardianContactCreate,
    user_id: str = Depends(get_current_user_id),
):
    db = get_supabase()
    email = str(payload.email).strip().lower()
    active_result = (
        db.table("guardian_contacts")
        .select("id")
        .eq("user_id", user_id)
        .eq("is_active", True)
        .execute()
    )
    if len(active_result.data or []) >= MAX_CONTACTS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You can add up to {MAX_CONTACTS} guardian contacts.",
        )

    existing = (
        db.table("guardian_contacts")
        .select("id,is_active")
        .eq("user_id", user_id)
        .eq("email", email)
        .limit(1)
        .execute()
    )
    if existing.data and existing.data[0].get("is_active"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This email address is already on your guardian contact list.",
        )

    now = datetime.now(timezone.utc)
    contact_values: dict[str, Any] = {
        "email": email,
        "status": "verified",
        "is_active": True,
        "verification_token_hash": None,
        "verification_expires_at": None,
        "verified_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    try:
        if existing.data:
            result = (
                db.table("guardian_contacts")
                .update(contact_values)
                .eq("id", existing.data[0]["id"])
                .eq("user_id", user_id)
                .execute()
            )
        else:
            result = (
                db.table("guardian_contacts")
                .insert({"user_id": user_id, **contact_values, "created_at": now.isoformat()})
                .execute()
            )
    except Exception as exc:
        _raise_contact_write_error(exc)

    if not result.data:
        raise HTTPException(status_code=500, detail="Unable to save this guardian contact.")
    contact = result.data[0]
    try:
        _send_guardian_added_alert(
            email=email,
            contact_id=str(contact["id"]),
            verified_at=str(contact.get("verified_at") or now.isoformat()),
        )
    except Exception as exc:
        logger.exception("Guardian contact alert email failed contact_id=%s", contact["id"])
        (
            db.table("guardian_contacts")
            .update(
                {
                    "is_active": False,
                    "status": "removed",
                    "verification_token_hash": None,
                    "verification_expires_at": None,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            .eq("id", contact["id"])
            .execute()
        )
        raise HTTPException(
            status_code=502,
            detail="Unable to send the alert email. Please try again.",
        ) from exc
    return {
        "id": contact["id"],
        "email": contact["email"],
        "status": contact["status"],
        "created_at": contact.get("created_at"),
    }


@router.delete("/contacts/{contact_id}")
def remove_guardian_contact(
    contact_id: str,
    user_id: str = Depends(get_current_user_id),
):
    result = (
        get_supabase()
        .table("guardian_contacts")
        .update(
            {
                "is_active": False,
                "status": "removed",
                "verification_token_hash": None,
                "verification_expires_at": None,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", contact_id)
        .eq("user_id", user_id)
        .eq("is_active", True)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Guardian contact was not found.")
    return {"message": "Guardian contact removed."}


@router.get("/contacts/verify", response_class=HTMLResponse)
def verify_guardian_contact(token: str = Query(..., min_length=20, max_length=256)):
    db = get_supabase()
    token_hash = hash_verification_token(token)
    result = (
        db.table("guardian_contacts")
        .select("id,verification_expires_at")
        .eq("verification_token_hash", token_hash)
        .eq("status", "pending")
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=400, detail="Verification link is invalid or has expired.")

    contact = result.data[0]
    expires_at = datetime.fromisoformat(
        contact["verification_expires_at"].replace("Z", "+00:00")
    )
    now = datetime.now(timezone.utc)
    if expires_at <= now:
        raise HTTPException(status_code=400, detail="Verification link is invalid or has expired.")

    (
        db.table("guardian_contacts")
        .update(
            {
                "status": "verified",
                "verification_token_hash": None,
                "verification_expires_at": None,
                "verified_at": now.isoformat(),
                "updated_at": now.isoformat(),
            }
        )
        .eq("id", contact["id"])
        .execute()
    )
    return HTMLResponse(
        "<h1>Email verified</h1><p>This address can now receive TruVoice guardian alerts.</p>"
    )


@router.get("/unsubscribe/{contact_id}", response_class=HTMLResponse)
def unsubscribe_guardian_contact(
    contact_id: str,
    token: str = Query(..., min_length=64, max_length=64),
):
    contact_result = (
        get_supabase()
        .table("guardian_contacts")
        .select("verified_at")
        .eq("id", contact_id)
        .limit(1)
        .execute()
    )
    if not contact_result.data or not contact_result.data[0].get("verified_at"):
        raise HTTPException(status_code=400, detail="Unsubscribe link is invalid.")

    expected = create_unsubscribe_token(
        contact_id,
        str(contact_result.data[0]["verified_at"]),
    )
    if not secrets.compare_digest(token, expected):
        raise HTTPException(status_code=400, detail="Unsubscribe link is invalid.")

    now = datetime.now(timezone.utc).isoformat()
    result = (
        get_supabase()
        .table("guardian_contacts")
        .update(
            {
                "is_active": False,
                "status": "opted_out",
                "verification_token_hash": None,
                "verification_expires_at": None,
                "updated_at": now,
            }
        )
        .eq("id", contact_id)
        .eq("is_active", True)
        .execute()
    )
    if result.data:
        (
            get_supabase()
            .table("guardian_alert_deliveries")
            .update({"status": "cancelled", "next_attempt_at": None, "updated_at": now})
            .eq("contact_id", contact_id)
            .in_("status", ["pending", "failed"])
            .execute()
        )
    return HTMLResponse(
        "<h1>Unsubscribed</h1><p>This address will no longer receive TruVoice guardian alerts.</p>"
    )
