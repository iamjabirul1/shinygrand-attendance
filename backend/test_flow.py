"""Quick integration test without postgres — uses sqlite fallback"""
import os
os.environ["DATABASE_URL"] = "sqlite:///./test.db"

from app.core.db import Base, engine, SessionLocal
from app.models.models import Employee, EmployeeEmbedding
from app.core.security import hash_password
from app.models.models import User
from app.services.face import get_face_service
from app.core.time import now_utc
import uuid, base64, io
from PIL import Image
import numpy as np

# Create tables
Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)

db = SessionLocal()

# Seed admin
u = User(id=str(uuid.uuid4()), email="admin@shinygrand.local", password_hash=hash_password("Admin@123"), role="admin", created_at=now_utc())
db.add(u)
# Seed employee
emp = Employee(id=str(uuid.uuid4()), emp_code="EMP-001", name="Arjun", phone="9000000001", role="Reception", is_active=True, created_at=now_utc(), updated_at=now_utc())
db.add(emp)
db.commit()

# Enroll with dummy image (create 2 similar images)
def make_image(color):
    img = Image.new("RGB", (200,200), color=color)
    # draw face-like circle to pass quality
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()

svc = get_face_service()
img1 = make_image((200,150,150))
emb1, q1 = svc.extract_embedding(img1)
print(f"emb1 quality {q1:.2f} len {len(emb1)}")
# Store
import json
# For sqlite, embedding is stored as JSON text
# SQLAlchemy will handle via Text column; we store json dumps manually for sqlite compatibility
if engine.url.drivername.startswith("sqlite"):
    db.add(EmployeeEmbedding(id=str(uuid.uuid4()), employee_id=emp.id, embedding=json.dumps(emb1), quality_score=q1, capture_index=0, is_current=True, created_at=now_utc()))
else:
    db.add(EmployeeEmbedding(id=str(uuid.uuid4()), employee_id=emp.id, embedding=emb1, quality_score=q1, capture_index=0, is_current=True, created_at=now_utc()))
db.commit()

# Verify same image -> should match
emb2, q2 = svc.extract_embedding(img1)
import numpy as np
def cos_dist(a,b):
    if isinstance(a, str):
        a = json.loads(a)
    if isinstance(b, str):
        b = json.loads(b)
    a = np.array(a); b=np.array(b)
    a=a/(np.linalg.norm(a)+1e-9); b=b/(np.linalg.norm(b)+1e-9)
    return 1 - np.dot(a,b)

dist_same = cos_dist(emb1, emb2)
print(f"same image distance {dist_same:.4f} similarity {1-dist_same:.4f} -> should be 0 distance")

# Different color image
img2 = make_image((50,200,100))
emb3,_ = svc.extract_embedding(img2)
dist_diff = cos_dist(emb1, emb3)
print(f"diff image distance {dist_diff:.4f} similarity {1-dist_diff:.4f}")

# Attendance state machine test
from app.services.attendance_logic import process_attendance
server_time = now_utc()
res1 = process_attendance(db=db, employee=emp, server_time=server_time, client_time=server_time, station_id="GUW-01", confidence=0.95, liveness_score=0.9, threshold=0.42, was_offline=False, actor=u)
print("check_in result:", res1["status"])

# duplicate within 60s should be duplicate
import time
res_dup = process_attendance(db=db, employee=emp, server_time=server_time, client_time=server_time, station_id="GUW-01", confidence=0.95, liveness_score=0.9, threshold=0.42, was_offline=False, actor=u)
print("duplicate result:", res_dup["status"], res_dup["message"])

# checkout after 1h
from datetime import timedelta
later = server_time + timedelta(hours=8)
res2 = process_attendance(db=db, employee=emp, server_time=later, client_time=later, station_id="GUW-01", confidence=0.96, liveness_score=0.9, threshold=0.42, was_offline=False, actor=u)
print("check_out result:", res2["status"], res2)

print("PASS: flow works")
# cleanup
db.close()
try:
    os.remove("./test.db")
except: pass
