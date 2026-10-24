import os
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

load_dotenv()
class Settings(BaseSettings):
    PROJECT_NAME: str = "AI Scam & Deepfake Detector API"
    SECRET_KEY: str = os.getenv("SECRET_KEY")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7 
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    SMTP_HOST: str = os.getenv("SMTP_HOST", "")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USERNAME: str = os.getenv("SMTP_USERNAME", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM_EMAIL: str = os.getenv("SMTP_FROM_EMAIL", "")
    GUARDIAN_GROQ_TIMEOUT_SECONDS: float = float(os.getenv("GUARDIAN_GROQ_TIMEOUT_SECONDS", "4"))

    # Agora Real-Time Communication (RTC) Settings
    AGORA_APP_ID: str = os.getenv("AGORA_APP_ID", "")
    AGORA_APP_CERTIFICATE: str = os.getenv("AGORA_APP_CERTIFICATE", "")

    # Server & Voice Stream Settings
    PUBLIC_SERVER_URL: str = os.getenv("PUBLIC_SERVER_URL", "http://localhost:8000")
    VOICE_ANALYSIS_CHUNK_SECONDS: float = float(os.getenv("VOICE_ANALYSIS_CHUNK_SECONDS", "3.0"))
    VOICE_ANALYSIS_INTERVAL_SECONDS: float = float(os.getenv("VOICE_ANALYSIS_INTERVAL_SECONDS", "3.0"))

    # Neural Deepfake Voice Detector Settings (Wav2Vec2)
    VOICE_MODEL_PATH: str = os.getenv("VOICE_MODEL_PATH", "model/best_model_fold4.pth")
    VOICE_THRESHOLD: float = float(os.getenv("VOICE_THRESHOLD", "0.5"))
    VOICE_MIN_RMS: float = float(os.getenv("VOICE_MIN_RMS", "0.003"))

    # Local GPU transcription and PII sanitization (faster-whisper).
    # large-v3-turbo provides a strong accuracy/latency balance on the RTX 4050.
    STT_MODEL_SIZE: str = os.getenv("STT_MODEL_SIZE", "large-v3-turbo")
    STT_COMPUTE_TYPE: str = os.getenv("STT_COMPUTE_TYPE", "float16")

settings = Settings()

