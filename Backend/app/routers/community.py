from fastapi import APIRouter, Depends, HTTPException

from app.database import get_supabase
from app.schemas import ScamComplaintRequest, SpamReportRequest
from app.utils.auth import get_current_user_id

router = APIRouter(prefix="/api/v1", tags=["Community Safety"])


@router.get("/spam-status/{phone_number}")
def get_spam_status(phone_number: str):
    normalized = phone_number.strip().replace(" ", "").replace("-", "")
    result = get_supabase().table("phone_spam_status").select("phone_number,report_count,is_spam,updated_at").eq("phone_number", normalized).execute()
    if not result.data:
        return {"phone_number": normalized, "report_count": 0, "is_spam": False}
    return result.data[0]


@router.post("/spam-reports", status_code=201)
def report_spam(payload: SpamReportRequest, user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    existing = db.table("spam_reports").select("id").eq("phone_number", payload.phone_number).eq("reporter_user_id", user_id).execute()
    if existing.data:
        raise HTTPException(status_code=409, detail="You have already reported this number as spam.")
    db.table("spam_reports").insert({"phone_number": payload.phone_number, "reporter_user_id": user_id}).execute()
    status_result = db.table("phone_spam_status").select("report_count,is_spam").eq("phone_number", payload.phone_number).execute()
    return {"message": "Spam report recorded.", **status_result.data[0]}


@router.post("/scam-complaints", status_code=201)
def submit_scam_complaint(payload: ScamComplaintRequest, user_id: str = Depends(get_current_user_id)):
    result = get_supabase().table("scam_complaints").insert(
        {"caller_number": payload.phone_number, "description": payload.description.strip(), "reporter_user_id": user_id}
    ).execute()
    return {"message": "Complaint submitted.", "complaint_id": result.data[0]["id"]}
