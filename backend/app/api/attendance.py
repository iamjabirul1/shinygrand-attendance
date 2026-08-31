import uuid, base64, json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import select, desc

from ..core.db import get_db
from ..core.config import get_settings
from ..core.time import now_utc, to_ist, attendance_date_ist
from ..models.models import Employee, EmployeeEmbedding, AttendanceSession, AttendanceRecord, AuditLog
from ..services.face import get_face_service
from ..services.attendance_logic import process_attendance
from .auth import require_auth, require_admin

router = APIRouter()
settings = get_settings()

class VerifyIn(BaseModel):
    image_base64: str  # cropped face jpeg base64 (without data: prefix ok) OR full frame; we handle both
    station_id: str = "GUW-01"
    client_time: str | None = None  # ISO
    liveness_score: float | None = None
    was_offline: bool = False
    # threshold override optional
    threshold: float | None = None

class VerifyEmbeddingIn(BaseModel):
    embedding: list[float]  # 128-d from browser face-api.js (or 512)
    station_id: str = "GUW-01"
    client_time: str | None = None
    liveness_score: float | None = None
    was_offline: bool = False
    threshold: float | None = None

@router.post("/verify")
def verify_and_mark(body: VerifyIn, db: Session = Depends(get_db), user=Depends(require_auth)):
    # decode image
    b64 = body.image_base64
    if "," in b64:
        b64 = b64.split(",",1)[1]
    try:
        img_bytes = base64.b64decode(b64)
    except Exception:
        raise HTTPException(400, "invalid base64")
    if len(img_bytes) < 500:
        raise HTTPException(400, "image too small")

    svc = get_face_service()
    try:
        query_emb, quality = svc.extract_embedding(img_bytes)
    except Exception as e:
        raise HTTPException(400, f"face not found or invalid: {e}")

    if quality < 0.25:
        raise HTTPException(400, f"low quality {quality:.2f}, move closer/better light")

    # 1:N search via pgvector cosine distance
    # pgvector <#> is cosine distance? Use <=> for cosine distance via operator? For simplicity we fetch all active embeddings (15*3=45) and compute in python
    rows = db.execute(select(EmployeeEmbedding, Employee).join(Employee, Employee.id==EmployeeEmbedding.employee_id).where(Employee.is_active==True, EmployeeEmbedding.is_current==True)).all()
    if not rows:
        raise HTTPException(400, "no enrolled employees")

    # compute cosine distance
    import numpy as np
    def cosine_dist(a,b):
        a=np.array(a, dtype=np.float32)
        b=np.array(b, dtype=np.float32)
        # normalize
        a = a / (np.linalg.norm(a)+1e-9)
        b = b / (np.linalg.norm(b)+1e-9)
        return float(1 - np.dot(a,b))

    best=None
    candidates=[]
    for emb_row, emp in rows:
        emb = emb_row.embedding
        # handle sqlite Text storage (json string)
        import json as _json
        if isinstance(emb, str):
            try:
                emb = _json.loads(emb)
            except:
                continue
        dist = cosine_dist(query_emb, emb)
        candidates.append((dist, emp, emb_row))
    candidates.sort(key=lambda x: x[0])
    top3 = candidates[:3]
    best_dist, best_emp, best_emb = top3[0]
    threshold = body.threshold or settings.ATTENDANCE_THRESHOLD
    confidence = 1 - best_dist  # similarity

    # decision
    if best_dist > threshold:
        # not recognized - if in 0.42-0.55 suggest candidates but don't mark
        if best_dist < 0.55:
            return {"status": "ambiguous", "message": f"Low confidence ({confidence:.2f}), please retry or ask admin", "candidates": [{"emp_code": e.emp_code, "name": e.name, "distance": d, "similarity": 1-d} for d,e,_ in top3], "threshold": threshold}
        raise HTTPException(404, f"Not recognized (similarity {confidence:.2f} < threshold {1-threshold:.2f})")

    # duplicate/cooldown check done in process_attendance
    # liveness flag
    liveness = body.liveness_score
    # authoritative time
    server_time = now_utc()
    client_time = None
    if body.client_time:
        try:
            client_time = datetime.fromisoformat(body.client_time.replace("Z","+00:00"))
        except:
            client_time=None

    result = process_attendance(db=db, employee=best_emp, server_time=server_time, client_time=client_time, station_id=body.station_id, confidence=confidence, liveness_score=liveness, threshold=threshold, was_offline=body.was_offline, actor=user)

    return {
        "status": result["status"],
        "employee": {"id": best_emp.id, "emp_code": best_emp.emp_code, "name": best_emp.name},
        "server_time": server_time.isoformat(),
        "server_time_ist": to_ist(server_time).isoformat(),
        "confidence": confidence,
        "distance": best_dist,
        "threshold": threshold,
        "session": result.get("session"),
        "record": result.get("record"),
        "message": result.get("message"),
    }

@router.post("/verify-embedding")
def verify_embedding(body: VerifyEmbeddingIn, db: Session = Depends(get_db), user=Depends(require_auth)):
    """Cloud accurate without Docker: frontend extracts 128-d via face-api.js, backend compares (cosine) - works on Vercel free 512MB"""
    if len(body.embedding) not in (128, 512):
        raise HTTPException(400, f"embedding must be 128 or 512-d, got {len(body.embedding)}")
    # Pad 128 to 512 for comparison with stored padded
    def pad512(emb):
        if len(emb) == 512:
            return emb
        if len(emb) == 128:
            return emb + [0.0]*384
        return (emb + [0.0]*512)[:512]
    query_emb = pad512(body.embedding)

    rows = db.execute(select(EmployeeEmbedding, Employee).join(Employee, Employee.id==EmployeeEmbedding.employee_id).where(Employee.is_active==True, EmployeeEmbedding.is_current==True)).all()
    if not rows:
        raise HTTPException(400, "no enrolled employees")

    import numpy as np
    def cosine_dist(a,b):
        # Handle stored as JSON string (sqlite) or list
        import json as _json
        if isinstance(b, str):
            try:
                b = _json.loads(b)
            except:
                return 1.0
        # Pad both to same len (512)
        if len(a) != len(b):
            maxlen = max(len(a), len(b))
            a = (a + [0.0]*maxlen)[:maxlen]
            b = (b + [0.0]*maxlen)[:maxlen]
        a = np.array(a, dtype=np.float32)
        b = np.array(b, dtype=np.float32)
        a = a / (np.linalg.norm(a)+1e-9)
        b = b / (np.linalg.norm(b)+1e-9)
        return float(1 - np.dot(a,b))

    candidates=[]
    for emb_row, emp in rows:
        dist = cosine_dist(query_emb, emb_row.embedding)
        candidates.append((dist, emp, emb_row))
    candidates.sort(key=lambda x: x[0])
    top3 = candidates[:3]
    best_dist, best_emp, best_emb = top3[0]
    # For 128-d face-api.js, threshold is typically 0.55-0.65 (face-api uses 0.6)
    # Our default 0.42 is for 512-d InsightFace, too strict for 128-d. Use 0.55 for 128.
    default_thresh = 0.55 if len(body.embedding)==128 else settings.ATTENDANCE_THRESHOLD
    threshold = body.threshold or default_thresh
    confidence = 1 - best_dist
    if best_dist > threshold:
        if best_dist < threshold+0.15:
            return {"status": "ambiguous", "message": f"Low confidence ({confidence:.2f}), please retry", "candidates": [{"emp_code": e.emp_code, "name": e.name, "distance": d, "similarity": 1-d} for d,e,_ in top3], "threshold": threshold}
        raise HTTPException(404, f"Not recognized (similarity {confidence:.2f} < threshold {1-threshold:.2f}, dist {best_dist:.2f})")
    server_time = now_utc()
    client_time = None
    if body.client_time:
        try:
            client_time = datetime.fromisoformat(body.client_time.replace("Z","+00:00"))
        except:
            client_time=None
    result = process_attendance(db=db, employee=best_emp, server_time=server_time, client_time=client_time, station_id=body.station_id, confidence=confidence, liveness_score=body.liveness_score, threshold=threshold, was_offline=body.was_offline, actor=user)
    return {
        "status": result["status"],
        "employee": {"id": best_emp.id, "emp_code": best_emp.emp_code, "name": best_emp.name},
        "server_time": server_time.isoformat(),
        "server_time_ist": to_ist(server_time).isoformat(),
        "confidence": confidence,
        "distance": best_dist,
        "threshold": threshold,
        "session": result.get("session"),
        "record": result.get("record"),
        "message": result.get("message"),
    }

@router.get("/")
def list_attendance(
    from_date: str | None = Query(None, description="YYYY-MM-DD IST"),
    to_date: str | None = None,
    employee_id: str | None = None,
    station_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    user=Depends(require_auth),
):
    q = select(AttendanceRecord).order_by(desc(AttendanceRecord.server_time))
    # For simplicity, filter in python if needed, but use SQL for employee
    if employee_id:
        q = q.where(AttendanceRecord.employee_id==employee_id)
    if station_id:
        q = q.where(AttendanceRecord.station_id==station_id)
    # date filter on server_time converted to IST
    rows = db.execute(q.limit(limit).offset(offset)).scalars().all()
    # filter by from/to IST if provided
    out=[]
    for r in rows:
        ist = to_ist(r.server_time)
        date_str = ist.date().isoformat()
        if from_date and date_str < from_date:
            continue
        if to_date and date_str > to_date:
            continue
        emp = db.get(Employee, r.employee_id)
        out.append({
            "id": r.id,
            "employee": {"id": emp.id, "emp_code": emp.emp_code, "name": emp.name} if emp else None,
            "type": r.type,
            "server_time": r.server_time.isoformat(),
            "server_time_ist": ist.isoformat(),
            "date": date_str,
            "station_id": r.station_id,
            "confidence": r.confidence,
            "liveness_score": r.liveness_score,
            "was_offline": r.was_offline,
            "is_corrected": r.is_corrected,
            "correction_reason": r.correction_reason,
        })
    return out

@router.get("/sessions")
def list_sessions(employee_id: str | None = None, date: str | None = None, db: Session = Depends(get_db), user=Depends(require_auth)):
    q = select(AttendanceSession).order_by(desc(AttendanceSession.check_in))
    if employee_id:
        q = q.where(AttendanceSession.employee_id==employee_id)
    rows = db.execute(q.limit(100)).scalars().all()
    out=[]
    for s in rows:
        emp = db.get(Employee, s.employee_id)
        ist_in = to_ist(s.check_in)
        ist_out = to_ist(s.check_out) if s.check_out else None
        date_str = ist_in.date().isoformat()
        if date and date_str != date:
            continue
        dur = None
        if s.check_out:
            dur = int((s.check_out - s.check_in).total_seconds() // 60)
        out.append({
            "id": s.id,
            "employee": {"emp_code": emp.emp_code, "name": emp.name} if emp else None,
            "check_in": s.check_in.isoformat(),
            "check_in_ist": ist_in.isoformat(),
            "check_out": s.check_out.isoformat() if s.check_out else None,
            "check_out_ist": ist_out.isoformat() if ist_out else None,
            "duration_minutes": dur,
            "status": s.status,
            "date": date_str,
        })
    return out

@router.post("/correct")
def correct_attendance(body: dict, db: Session = Depends(get_db), admin=Depends(require_admin)):
    """
    body: {record_id, new_server_time ISO, reason}
    Creates correction record, marks original is_corrected, updates session.
    """
    record_id = body.get("record_id")
    new_time = body.get("new_server_time")
    reason = body.get("reason", "manual correction")
    if not record_id or not new_time:
        raise HTTPException(400, "record_id and new_server_time required")
    rec = db.get(AttendanceRecord, record_id)
    if not rec:
        raise HTTPException(404, "record not found")
    # mark original corrected
    rec.is_corrected = True
    rec.correction_reason = reason
    rec.corrected_by = admin.id
    # create new corrected record
    new_rec = AttendanceRecord(
        id=str(uuid.uuid4()),
        session_id=rec.session_id,
        employee_id=rec.employee_id,
        type=rec.type,
        server_time=datetime.fromisoformat(new_time.replace("Z","+00:00")),
        client_time=rec.client_time,
        station_id=rec.station_id,
        confidence=rec.confidence,
        threshold=rec.threshold,
        is_corrected=False,
        was_offline=False,
        correction_reason=None,
        created_at=now_utc(),
    )
    db.add(new_rec)
    # if session check_in/out corresponds, update session
    if rec.session_id:
        sess = db.get(AttendanceSession, rec.session_id)
        if sess:
            if rec.type == "check_in":
                sess.check_in = new_rec.server_time
            elif rec.type == "check_out":
                sess.check_out = new_rec.server_time
    db.add(AuditLog(id=str(uuid.uuid4()), actor_id=admin.id, action="correct", entity="attendance_records", entity_id=record_id, before=json.dumps({"server_time": rec.server_time.isoformat()}), after=json.dumps({"new_time": new_time, "reason": reason}), created_at=now_utc()))
    db.commit()
    return {"ok": True, "new_id": new_rec.id}

@router.get("/export.csv")
def export_csv(from_date: str | None = None, to_date: str | None = None, db: Session = Depends(get_db), user=Depends(require_auth)):
    from fastapi.responses import StreamingResponse
    import csv, io
    rows = list_attendance(from_date=from_date, to_date=to_date, limit=10000, db=db, user=user)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["date","emp_code","name","type","server_time_ist","station","confidence","was_offline","is_corrected"])
    for r in rows:
        w.writerow([r["date"], r["employee"]["emp_code"], r["employee"]["name"], r["type"], r["server_time_ist"], r["station_id"], r["confidence"], r["was_offline"], r["is_corrected"]])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition":"attachment; filename=attendance.csv"})
