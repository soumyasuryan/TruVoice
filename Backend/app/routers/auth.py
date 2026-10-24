from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, status

from app.database import get_supabase
from app.schemas import LoginRequest, ResendOtpRequest, SignUpRequest, TokenResponse, VerifyOtpRequest
from app.utils.auth import create_access_token, hash_password, verify_password
from app.utils.otp import generate_otp, send_email_otp

router = APIRouter(prefix="/auth", tags=["Authentication"])
OTP_LIFETIME = timedelta(minutes=10)
RESEND_COOLDOWN = timedelta(seconds=60)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _send_and_store_otp(phone_number: str, purpose: str, email: str | None = None) -> None:
    """Persist a one-time OTP and email it to the account owner."""
    db = get_supabase()
    now = _utc_now()
    existing = db.table("otp_store").select("last_sent_at").eq("phone_number", phone_number).execute()
    if existing.data and existing.data[0].get("last_sent_at"):
        last_sent = datetime.fromisoformat(existing.data[0]["last_sent_at"].replace("Z", "+00:00"))
        if now - last_sent < RESEND_COOLDOWN:
            raise HTTPException(status_code=429, detail="Please wait 60 seconds before requesting another OTP.")

    otp_code = generate_otp()
    db.table("otp_store").upsert(
        {
            "phone_number": phone_number,
            "purpose": purpose,
            "otp_hash": hash_password(otp_code),
            "expires_at": (now + OTP_LIFETIME).isoformat(),
            "last_sent_at": now.isoformat(),
            "attempts": 0,
        },
        on_conflict="phone_number",
    ).execute()
    if not email:
        raise HTTPException(status_code=400, detail="An email address is required for OTP delivery.")
    try:
        send_email_otp(email, otp_code)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Unable to deliver the verification email. Please try again.") from exc


@router.post("/signup/initiate")
def initiate_signup(payload: SignUpRequest):
    db = get_supabase()
    existing = db.table("users").select("id,is_verified").eq("phone_number", payload.phone_number).execute()
    if existing.data and existing.data[0]["is_verified"]:
        raise HTTPException(status_code=400, detail="Mobile number already registered. Please login instead.")
    email_owner = db.table("users").select("id").eq("email", str(payload.email).lower()).execute()
    if email_owner.data and (not existing.data or email_owner.data[0]["id"] != existing.data[0]["id"]):
        raise HTTPException(status_code=400, detail="Email address is already registered. Please use another email.")

    db.table("users").upsert(
        {
            "name": payload.name.strip(),
            "age": payload.age,
            "email": str(payload.email).lower(),
            "phone_number": payload.phone_number,
            "password_hash": hash_password(payload.password),
            "is_verified": False,
        },
        on_conflict="phone_number",
    ).execute()
    _send_and_store_otp(payload.phone_number, "signup", str(payload.email).lower())
    return {"message": "Verification OTP sent to email.", "phone_number": payload.phone_number, "email": str(payload.email).lower()}


@router.post("/signup/verify", response_model=TokenResponse)
def verify_signup_otp(payload: VerifyOtpRequest):
    if payload.purpose != "signup":
        raise HTTPException(status_code=400, detail="Use purpose 'signup' for this endpoint.")
    user = _verify_otp(payload)
    get_supabase().table("users").update({"is_verified": True}).eq("id", user["id"]).execute()
    return _token_response(user)


@router.post("/login/initiate")
def initiate_login(payload: LoginRequest):
    db = get_supabase()
    result = db.table("users").select("id,password_hash,is_verified,email").eq("phone_number", payload.phone_number).execute()
    if not result.data or not verify_password(payload.password, result.data[0]["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid mobile number or password.")
    if not result.data[0]["is_verified"]:
        raise HTTPException(status_code=403, detail="Please verify your mobile number before logging in.")
    _send_and_store_otp(payload.phone_number, "login", result.data[0]["email"])
    return {"message": "Credentials verified. OTP sent to registered email.", "phone_number": payload.phone_number}


@router.post("/login/verify", response_model=TokenResponse)
def verify_login_otp(payload: VerifyOtpRequest):
    if payload.purpose != "login":
        raise HTTPException(status_code=400, detail="Use purpose 'login' for this endpoint.")
    return _token_response(_verify_otp(payload))


@router.post("/resend-otp")
def resend_otp(payload: ResendOtpRequest):
    db = get_supabase()
    user = db.table("users").select("is_verified,email").eq("phone_number", payload.phone_number).execute()
    if not user.data:
        raise HTTPException(status_code=404, detail="No signup request exists for this mobile number.")
    if payload.purpose == "signup" and user.data[0]["is_verified"]:
        raise HTTPException(status_code=400, detail="This mobile number is already verified.")
    if payload.purpose == "login" and not user.data[0]["is_verified"]:
        raise HTTPException(status_code=403, detail="Verify the signup OTP first.")
    _send_and_store_otp(payload.phone_number, payload.purpose, user.data[0].get("email"))
    return {"message": "OTP resent successfully.", "phone_number": payload.phone_number}


def _verify_otp(payload: VerifyOtpRequest) -> dict:
    db = get_supabase()
    otp = db.table("otp_store").select("otp_hash,expires_at,purpose,attempts").eq("phone_number", payload.phone_number).execute()
    if not otp.data:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP.")
    record = otp.data[0]
    expires_at = datetime.fromisoformat(record["expires_at"].replace("Z", "+00:00"))
    valid = record["purpose"] == payload.purpose and expires_at > _utc_now() and verify_password(payload.otp, record["otp_hash"])
    if not valid:
        attempts = record.get("attempts", 0) + 1
        if attempts >= 5:
            db.table("otp_store").delete().eq("phone_number", payload.phone_number).execute()
        else:
            db.table("otp_store").update({"attempts": attempts}).eq("phone_number", payload.phone_number).execute()
        raise HTTPException(status_code=400, detail="Invalid or expired OTP.")
    db.table("otp_store").delete().eq("phone_number", payload.phone_number).execute()
    user = db.table("users").select("id,phone_number").eq("phone_number", payload.phone_number).execute()
    if not user.data:
        raise HTTPException(status_code=404, detail="User account was not found.")
    return user.data[0]


def _token_response(user: dict) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token({"sub": str(user["id"])}),
        user_id=str(user["id"]),
        phone_number=user["phone_number"],
    )


@router.post("/logout")
def logout():
    return {"message": "Logged out successfully. Remove the access token on the client."}
