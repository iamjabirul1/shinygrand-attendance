import uuid, base64, io
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..core.db import get_db
from ..core.time import now_utc
from ..models.models import Employee, EmployeeEmbedding, AuditLog
from .auth import require_admin, require_auth
from ..services.face import get_face_service

router = APIRouter()

class EmpCreate(BaseModel):
    emp_code: str
    name: str
    phone: str | None = None
    role: str | None = None

class EnrollEmbeddingIn(BaseModel):
    embeddings: list[list[float]]  # 128-d from browser face-api.js, 3 angles
    quality_scores: list[float] | None = None

@router.get("/")
def list_employees(db: Session = Depends(get_db), user=Depends(require_auth)):
    emps = db.execute(select(Employee).order_by(Employee.emp_code)).scalars().all()
    # count embeddings
    out=[]
    for e in emps:
        cnt = db.execute(select(EmployeeEmbedding).where(EmployeeEmbedding.employee_id==e.id, EmployeeEmbedding.is_current==True)).scalars().all()
        out.append({"id": e.id, "emp_code": e.emp_code, "name": e.name, "phone": e.phone, "role": e.role, "is_active": e.is_active, "embeddings": len(cnt)})
    return out

@router.post("/")
def create_employee(body: EmpCreate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    exists = db.execute(select(Employee).where(Employee.emp_code==body.emp_code)).scalars().first()
    if exists:
        raise HTTPException(400, "emp_code exists")
    emp = Employee(emp_code=body.emp_code, name=body.name, phone=body.phone, role=body.role)
    emp.id = str(uuid.uuid4())
    emp.created_at = now_utc()
    emp.updated_at = now_utc()
    db.add(emp)
    db.commit()
    db.refresh(emp)
    db.add(AuditLog(id=str(uuid.uuid4()), actor_id=admin.id, action="create", entity="employee", entity_id=emp.id, after=str(body.model_dump()), created_at=now_utc()))
    db.commit()
    return {"id": emp.id, "emp_code": emp.emp_code, "name": emp.name}

@router.post("/{employee_id}/enroll")
async def enroll_employee(
    employee_id: str,
    files: list[UploadFile] = File(..., description="3-5 face images"),
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    emp = db.get(Employee, employee_id)
    if not emp:
        raise HTTPException(404, "employee not found")
    if len(files) < 1 or len(files) > 5:
        raise HTTPException(400, "provide 1-5 images")

    svc = get_face_service()
    embeddings=[]
    errors=[]
    for idx, f in enumerate(files):
        data = await f.read()
        try:
            emb, quality = svc.extract_embedding(data)
            if quality < 0.3:
                errors.append(f"{f.filename}: low quality {quality:.2f}")
                continue
            embeddings.append((emb, quality, idx))
        except Exception as e:
            errors.append(f"{f.filename}: {e}")

    if not embeddings:
        raise HTTPException(400, f"No valid faces: {errors}")

    # deactivate old
    db.query(EmployeeEmbedding).filter(EmployeeEmbedding.employee_id==employee_id).update({"is_current": False})
    import json as _json
    from ..core.config import get_settings as _gs
    _is_sqlite = _gs().DATABASE_URL.startswith("sqlite")
    for emb, quality, idx in embeddings:
        stor_emb = _json.dumps(emb) if _is_sqlite else emb
        rec = EmployeeEmbedding(id=str(uuid.uuid4()), employee_id=employee_id, embedding=stor_emb, quality_score=quality, capture_index=idx, is_current=True, created_at=now_utc())  # type: ignore
        db.add(rec)
    db.commit()
    db.add(AuditLog(id=str(uuid.uuid4()), actor_id=admin.id, action="enroll", entity="employee", entity_id=employee_id, after=f"enrolled {len(embeddings)} embeddings, errors={errors}", created_at=now_utc()))
    db.commit()
    return {"ok": True, "enrolled": len(embeddings), "errors": errors}

@router.post("/{employee_id}/enroll-embedding")
def enroll_embedding(
    employee_id: str,
    body: EnrollEmbeddingIn,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    """Cloud-accurate without Docker: browser extracts 128-d via face-api.js, backend just stores & compares (cosine). Works on Vercel free."""
    emp = db.get(Employee, employee_id)
    if not emp:
        raise HTTPException(404, "employee not found")
    if len(body.embeddings) < 1 or len(body.embeddings) > 5:
        raise HTTPException(400, "provide 1-5 embeddings")
    # Validate dims 128
    for emb in body.embeddings:
        if len(emb) != 128:
            raise HTTPException(400, f"embedding must be 128-d, got {len(emb)}")
    db.query(EmployeeEmbedding).filter(EmployeeEmbedding.employee_id==employee_id).update({"is_current": False})
    import json as _json
    from ..core.config import get_settings as _gs
    _is_sqlite = _gs().DATABASE_URL.startswith("sqlite")
    def pad512(emb):
        if len(emb) == 512:
            return emb
        if len(emb) == 128:
            return emb + [0.0]*384
        if len(emb) < 512:
            return emb + [0.0]*(512-len(emb))
        return emb[:512]
    for idx, emb in enumerate(body.embeddings):
        q = body.quality_scores[idx] if body.quality_scores and idx < len(body.quality_scores) else 0.9
        # Pad 128-d (face-api.js) to 512 for VECTOR(512) column compatibility
        padded = pad512(emb)
        stor_emb = _json.dumps(padded) if _is_sqlite else padded
        rec = EmployeeEmbedding(id=str(uuid.uuid4()), employee_id=employee_id, embedding=stor_emb, quality_score=q, capture_index=idx, is_current=True, created_at=now_utc())  # type: ignore
        db.add(rec)
    db.commit()
    db.add(AuditLog(id=str(uuid.uuid4()), actor_id=admin.id, action="enroll-embedding", entity="employee", entity_id=employee_id, after=f"enrolled {len(body.embeddings)} embeddings (browser)", created_at=now_utc()))
    db.commit()
    return {"ok": True, "enrolled": len(body.embeddings)}

@router.post("/{employee_id}/deactivate")
def deactivate(employee_id: str, db: Session = Depends(get_db), admin=Depends(require_admin)):
    emp = db.get(Employee, employee_id)
    if not emp:
        raise HTTPException(404, "not found")
    emp.is_active = not emp.is_active
    emp.updated_at = now_utc()
    db.commit()
    return {"ok": True, "is_active": emp.is_active}

@router.delete("/{employee_id}")
def delete_employee(employee_id: str, db: Session = Depends(get_db), admin=Depends(require_admin)):
    emp = db.get(Employee, employee_id)
    if not emp:
        raise HTTPException(404, "not found")
    db.delete(emp)
    db.commit()
    return {"ok": True}
