from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator


class PhoneNumberModel(BaseModel):
    phone_number: str = Field(..., examples=["+918787878778"])

    @field_validator("phone_number")
    @classmethod
    def normalize_phone_number(cls, value: str) -> str:
        normalized = value.strip().replace(" ", "").replace("-", "")
        if not normalized.startswith("+") or not normalized[1:].isdigit() or not 8 <= len(normalized[1:]) <= 15:
            raise ValueError("Use an E.164 phone number, for example +919876543210.")
        return normalized


class SignUpRequest(PhoneNumberModel):
    name: str = Field(..., min_length=2, max_length=100)
    age: int = Field(..., ge=13, le=120)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class LoginRequest(PhoneNumberModel):
    password: str = Field(..., min_length=8, max_length=128)


class VerifyOtpRequest(PhoneNumberModel):
    otp: str = Field(..., pattern=r"^\d{6}$")
    purpose: Literal["signup", "login"]


class ResendOtpRequest(PhoneNumberModel):
    purpose: Literal["signup", "login"]


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    phone_number: str


class AudioAnalysisResponse(BaseModel):
    file_name: str
    transcript: str
    ai_voice_probability: float
    scam_intent_score: float
    unified_risk_score: float
    trust_score: float
    risk_level: str
    scam_category: str
    flagged_keywords: list[str]
    reasoning: str


class AudioBase64Request(BaseModel):
    audio_base64: str
    caller_number: str | None = None
    call_id: str | None = None


class SpamReportRequest(PhoneNumberModel):
    pass


class ScamComplaintRequest(PhoneNumberModel):
    description: str = Field(..., min_length=5, max_length=2_000)


class ElderlyModeUpdate(BaseModel):
    enabled: bool


class GuardianContactCreate(BaseModel):
    email: EmailStr


class AgoraTokenRequest(BaseModel):
    channelName: str = Field(..., min_length=1, max_length=128)


class AgoraTokenResponse(BaseModel):
    token: str
    channelName: str
    user_id: str
    uid: int


class LogCallRequest(BaseModel):
    channelName: str = Field(..., min_length=1, max_length=128)
    targetUserId: str = Field(..., min_length=1)
    targetPhoneNumber: str | None = None


class LogCallResponse(BaseModel):
    call_id: str
    channel_name: str
    status: str


class UpdateCallStatusRequest(BaseModel):
    call_id: str
    status: str
    duration: int = 0


class VoiceCallResponse(BaseModel):
    id: str
    user_id: str
    target_user_id: str | None = None
    channel_name: str | None = None
    status: str
    risk_level: str
    trust_score: float
    confidence: float
    is_scam: bool
    is_ai_voice: bool
    transcript: str
    signals: list[str] = []
    duration: int = 0
    created_at: str | None = None

