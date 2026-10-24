import secrets
import smtplib
from email.message import EmailMessage

from app.config import settings


def generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def send_email(
    email: str,
    subject: str,
    text_body: str,
    html_body: str | None = None,
) -> None:
    """Send a message through the SMTP account used for OTP mail."""
    required = (settings.SMTP_HOST, settings.SMTP_USERNAME, settings.SMTP_PASSWORD, settings.SMTP_FROM_EMAIL)
    if not all(required):
        raise RuntimeError("SMTP email is not configured. Set SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, and SMTP_FROM_EMAIL.")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.SMTP_FROM_EMAIL
    message["To"] = email
    message.set_content(text_body)
    if html_body:
        message.add_alternative(html_body, subtype="html")
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as smtp:
        smtp.starttls()
        smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        smtp.send_message(message)


def send_email_otp(email: str, otp_code: str) -> None:
    """Send a verification OTP through the configured SMTP account."""
    send_email(
        email,
        "Your TruVoice verification code",
        f"Your TruVoice verification code is {otp_code}. It expires in 10 minutes. Do not share it with anyone.",
    )
