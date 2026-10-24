import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Add project root directory to sys.path to allow running directly from app/ or project root
root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("truvoice")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
from app.config import settings
from app.routers import analysis, auth, community, guardian_alerts, voice
from app.utils.pipeline import get_pipeline


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=" * 70)
    logger.info("  TRUVOICE BACKEND STARTUP")
    logger.info(f"  Target Voice Model : {settings.VOICE_MODEL_PATH}")
    logger.info("=" * 70)
    # Pre-warm model in memory so first inference is instant
    try:
        pipeline = get_pipeline()
        logger.info(
            f"  [SUCCESS] VoiceDetector active: {pipeline.voice_detector.model_path} "
            f"(Device: {pipeline.voice_detector.device})"
        )
    except Exception as e:
        logger.error(f"  [ERROR] Failed to preload voice model: {e}")
    logger.info("=" * 70)
    yield


app = FastAPI(
    title="AI Voice Scam Detector API",
    description="Backend API handling Phone Auth and Dual-Pipeline AI Scam Detection.",
    version="1.0.0",
    lifespan=lifespan,
)

# Enable CORS for React Native & Web Frontends
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(auth.router)
app.include_router(analysis.router)
app.include_router(community.router)
app.include_router(guardian_alerts.router)
app.include_router(voice.router)
app.include_router(voice.ws_router)


@app.get("/")
def root():
    pipeline = get_pipeline()
    return {
        "status": "online",
        "message": "AI Voice Scam Detection API operational.",
        "active_model": pipeline.voice_detector.model_path,
        "device": str(pipeline.voice_detector.device),
    }


# AWS Lambda Handler Wrapper
handler = Mangum(app)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)

