import time
import logging
from app.config import settings

logger = logging.getLogger(__name__)


def _compute_uid(user_id: str) -> int:
    """
    Deterministic numeric UID computed from a user UUID string.
    MUST produce the identical value as agoraService.js _computeUid() so the token
    covers the exact UID that the frontend passes to joinChannel().
    """
    source = str(user_id).strip().lower()
    uid = 0
    for i, ch in enumerate(source):
        uid = (uid + (i + 1) * ord(ch)) % 1_000_000_000
    return uid + 1


def generate_rtc_token(channel_name: str, user_id: str, expiration_time_in_seconds: int = 3600) -> str:
    """
    Generates an Agora AccessToken2 ("007..." format) for joining a voice channel.

    Uses Agora's official AccessToken2 algorithm implemented in `app.agora_token`,
    which generates the 007... token format required by react-native-agora 4.x.
    """
    app_id = settings.AGORA_APP_ID
    app_certificate = settings.AGORA_APP_CERTIFICATE

    if not app_id or not app_certificate:
        logger.warning(
            "AGORA_APP_ID or AGORA_APP_CERTIFICATE is missing from .env. "
            "Returning placeholder token — Agora media will NOT work."
        )
        return f"agora_dev_token_{channel_name}_{user_id}"

    uid_value = _compute_uid(user_id)

    logger.info(
        f"Generating Agora AccessToken2: channel={channel_name}, "
        f"userId={user_id[:8]}..., uid={uid_value}, "
        f"appId={app_id[:8]}..."
    )

    # --- Primary: app.agora_token official Agora AccessToken2 builder ---
    try:
        from app.agora_token import RtcTokenBuilder, Role_Publisher

        token = RtcTokenBuilder.build_token_with_uid(
            app_id=app_id,
            app_certificate=app_certificate,
            channel_name=channel_name,
            uid=uid_value,
            role=Role_Publisher,
            token_expire=expiration_time_in_seconds,
            privilege_expire=expiration_time_in_seconds,
        )
        logger.info(
            f"AccessToken2 generated: starts_with_007={str(token).startswith('007')}, "
            f"uid={uid_value}, len={len(token)}"
        )
        return token
    except Exception as e:
        logger.error(f"app.agora_token AccessToken2 failed: {e}. Trying fallback to agora_token_builder...")

    # --- Fallback: agora_token_builder (v1 AccessToken) ---
    try:
        from agora_token_builder import RtcTokenBuilder as V1Builder  # type: ignore

        expire_ts = int(time.time()) + expiration_time_in_seconds
        token = V1Builder.buildTokenWithUid(
            app_id,
            app_certificate,
            channel_name,
            uid_value,
            1,  # Role_Publisher
            expire_ts,
        )
        logger.info(f"Fallback v1 token generated: starts_with_006={str(token).startswith('006')}, uid={uid_value}")
        return token
    except Exception as e2:
        logger.error(f"All Agora token generators failed: {e2}")
        return f"agora_dev_token_{channel_name}_{user_id}"
