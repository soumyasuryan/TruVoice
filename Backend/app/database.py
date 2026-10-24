import os
from dotenv import load_dotenv
from supabase import Client, create_client
load_dotenv()
supabase_url = os.getenv("SUPABASE_URL", "")
supabase_key = os.getenv("SUPABASE_KEY", "")

if not supabase_url or not supabase_key:
    print("Warning: SUPABASE_URL or SUPABASE_KEY is missing from environment variables.")

supabase: Client | None = create_client(supabase_url, supabase_key) if supabase_url and supabase_key else None


def get_supabase() -> Client:
    if supabase is None:
        raise RuntimeError("Supabase client is not configured. Check environment variables.")
    return supabase
