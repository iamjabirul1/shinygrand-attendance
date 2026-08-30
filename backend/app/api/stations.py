import uuid, json, qrcode, io, base64
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.security import create_station_token, decode_token
from ..core.time import now_utc
from ..models.models import Station
from .auth import require_admin, require_auth, bearer

router = APIRouter()

@router.get("/")
def list_stations(db: Session = Depends(get_db), user=Depends(require_auth)):
    stations = db.query(Station).all()
    return [{"id": s.id, "name": s.name, "is_active": s.is_active, "last_heartbeat": s.last_heartbeat} for s in stations]

@router.post("/pair-qr")
def pair_qr(station_id: str = "GUW-01", db: Session = Depends(get_db), admin=Depends(require_admin)):
    station = db.get(Station, station_id)
    if not station:
        station = Station(id=station_id, name="Reception", is_active=True, created_at=now_utc())
        db.add(station)
        db.commit()
    token = create_station_token(station_id)
    # Build QR png base64
    # frontend will construct camera URL as {frontendUrl}/camera?token=...
    # we encode token itself in QR payload for simplicity
    img = qrcode.make(token)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return {"station_id": station_id, "token": token, "qr_base64": f"data:image/png;base64,{b64}"}

@router.post("/heartbeat")
def heartbeat(body: dict, db: Session = Depends(get_db), user=Depends(require_auth)):
    # accepts station token
    # user may be station dict
    from fastapi.security import HTTPAuthorizationCredentials
    # already auth'd via require_auth
    # extract station_id
    station_id = body.get("station_id") or (user.get("station_id") if isinstance(user, dict) else None)
    if not station_id:
        raise HTTPException(400, "station_id required")
    st = db.get(Station, station_id)
    if not st:
        raise HTTPException(404, "station not found")
    st.last_heartbeat = now_utc()
    db.commit()
    return {"ok": True, "ts": st.last_heartbeat}

@router.get("/validate")
def validate_token(token: str):
    payload = decode_token(token)
    if payload.get("scope") != "station":
        raise HTTPException(400, "not station token")
    return {"ok": True, "station_id": payload.get("station_id")}
