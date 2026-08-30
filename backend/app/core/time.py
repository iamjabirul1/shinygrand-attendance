from datetime import datetime, timezone
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def now_ist() -> datetime:
    return now_utc().astimezone(IST)

def to_ist(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST)

def attendance_date_ist(dt: datetime) -> str:
    return to_ist(dt).date().isoformat()
