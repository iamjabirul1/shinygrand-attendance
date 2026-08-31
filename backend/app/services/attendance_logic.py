import uuid, json
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import select, desc
from ..models.models import AttendanceSession, AttendanceRecord, AuditLog
from ..core.time import now_utc
from ..core.config import get_settings

settings = get_settings()

def process_attendance(db: Session, employee, server_time: datetime, client_time, station_id: str, confidence: float, liveness_score, threshold: float, was_offline: bool, actor):
    """
    State machine:
    - If no open session -> check_in
    - Else -> check_out (close session, compute duration)
    - Cooldown 60s duplicate prevention
    - Auto-close stale handled by cron not here
    """
    open_sess = db.execute(select(AttendanceSession).where(AttendanceSession.employee_id==employee.id, AttendanceSession.status=="open").order_by(desc(AttendanceSession.check_in))).scalars().first()
    # Determine next action based on open session
    next_type = "check_out" if open_sess else "check_in"

    # Cooldown: only block if same type as last within 60s (allows quick check-in -> check-out for testing)
    last = db.execute(select(AttendanceRecord).where(AttendanceRecord.employee_id==employee.id).order_by(desc(AttendanceRecord.server_time)).limit(1)).scalars().first()
    if last:
        lt = last.server_time
        if lt.tzinfo is None:
            lt = lt.replace(tzinfo=timezone.utc)
        st = server_time
        if st.tzinfo is None:
            st = st.replace(tzinfo=timezone.utc)
        diff = (st - lt).total_seconds()
        # Only block duplicate if same type (e.g., check_in -> check_in within 60s), allow check_in -> check_out immediately
        if diff < settings.ATTENDANCE_COOLDOWN_SECONDS and last.type == next_type:
            remaining = int(settings.ATTENDANCE_COOLDOWN_SECONDS - diff)
            return {"status": "duplicate", "message": f"Already {last.type} at {last.server_time.isoformat()} ({int(diff)}s ago) — wait {remaining}s", "record": {"id": last.id, "type": last.type}, "next_type": next_type, "remaining": remaining}

    raw_actor_id = actor.get("id") if isinstance(actor, dict) else getattr(actor, "id", None)
    # Validate UUID: station tokens have id "station:GUW-01" which is not UUID -> store None
    import uuid as _uuid
    actor_id = None
    if raw_actor_id:
        try:
            _uuid.UUID(str(raw_actor_id))
            actor_id = str(raw_actor_id)
        except:
            actor_id = None

    if not open_sess:
        # check_in
        sess = AttendanceSession(id=str(uuid.uuid4()), employee_id=employee.id, check_in=server_time, check_in_station=station_id, status="open", created_at=now_utc())
        db.add(sess)
        db.flush()
        rec = AttendanceRecord(id=str(uuid.uuid4()), session_id=sess.id, employee_id=employee.id, type="check_in", server_time=server_time, client_time=client_time, station_id=station_id, confidence=confidence, liveness_score=liveness_score, threshold=threshold, was_offline=was_offline, created_at=now_utc())
        db.add(rec)
        db.add(AuditLog(id=str(uuid.uuid4()), actor_id=actor_id, action="check_in", entity="attendance_records", entity_id=rec.id, after=json.dumps({"emp": employee.emp_code, "time": server_time.isoformat()}), created_at=now_utc()))
        db.commit()
        return {"status": "checked_in", "message": f"Checked in at {server_time.isoformat()}", "session": {"id": sess.id}, "record": {"id": rec.id}}
    else:
        # check_out
        # prevent checkout if check_in is future? always check_out > check_in
        ci = open_sess.check_in
        if ci.tzinfo is None:
            ci = ci.replace(tzinfo=timezone.utc)
        st2 = server_time
        if st2.tzinfo is None:
            st2 = st2.replace(tzinfo=timezone.utc)
        if st2 <= ci:
            raise ValueError("server_time must be after check_in")
        open_sess.check_out = server_time
        open_sess.check_out_station = station_id
        open_sess.status = "closed"
        rec = AttendanceRecord(id=str(uuid.uuid4()), session_id=open_sess.id, employee_id=employee.id, type="check_out", server_time=server_time, client_time=client_time, station_id=station_id, confidence=confidence, liveness_score=liveness_score, threshold=threshold, was_offline=was_offline, created_at=now_utc())
        db.add(rec)
        db.add(AuditLog(id=str(uuid.uuid4()), actor_id=actor_id, action="check_out", entity="attendance_records", entity_id=rec.id, after=json.dumps({"emp": employee.emp_code, "time": server_time.isoformat()}), created_at=now_utc()))
        db.commit()
        # duration with tz-aware handling
        ci3 = open_sess.check_in
        if ci3.tzinfo is None:
            ci3 = ci3.replace(tzinfo=timezone.utc)
        st3 = server_time
        if st3.tzinfo is None:
            st3 = st3.replace(tzinfo=timezone.utc)
        dur = int((st3 - ci3).total_seconds() // 60)
        return {"status": "checked_out", "message": f"Checked out, worked {dur} min", "session": {"id": open_sess.id, "duration_minutes": dur}, "record": {"id": rec.id}}
