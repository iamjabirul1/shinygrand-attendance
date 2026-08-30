from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..core.db import get_db
from ..core.security import hash_password, verify_password, create_access_token, decode_token
from ..models.models import User

router = APIRouter()

class LoginIn(BaseModel):
    email: str
    password: str

class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str

@router.post("/seed")
def seed_admin(db: Session = Depends(get_db)):
    # One-time seed if no users
    existing = db.execute(select(User)).scalars().first()
    if existing:
        return {"ok": False, "msg": "already seeded"}
    u = User(email="admin@shinygrand.local", password_hash=hash_password("Admin@123"), role="admin")
    db.add(u)
    db.commit()
    return {"ok": True, "email": u.email}

@router.post("/login", response_model=LoginOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.email == body.email)).scalars().first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_access_token({"sub": user.id, "email": user.email, "role": user.role})
    return {"access_token": token, "role": user.role}

def get_current_user(token: str = Depends(lambda: "")):
    # placeholder, actual dependency uses header
    raise NotImplementedError

from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
bearer = HTTPBearer(auto_error=False)

def require_auth(creds: HTTPAuthorizationCredentials = Depends(bearer), db: Session = Depends(get_db)):
    if not creds:
        raise HTTPException(status_code=401, detail="Missing token")
    payload = decode_token(creds.credentials)
    user_id = payload.get("sub")
    # allow station tokens to pass? check scope
    if payload.get("scope") == "station":
        # return a synthetic station actor
        return {"id": user_id, "role": "station", "station_id": payload.get("station_id")}
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

def require_admin(user=Depends(require_auth)):
    # station cannot be admin
    if isinstance(user, dict):
        raise HTTPException(status_code=403, detail="Admin required")
    if user.role not in ("admin",):
        raise HTTPException(status_code=403, detail="Admin required")
    return user
