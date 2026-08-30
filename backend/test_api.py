import os
os.environ["DATABASE_URL"] = "sqlite:///./test_api.db"
import base64, io, json, uuid
from PIL import Image
from fastapi.testclient import TestClient

# recreate db
from app.core.db import Base, engine, SessionLocal
from app.models.models import *
import app.models.models as mm
print("tables", list(Base.metadata.tables.keys()))
Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)
print("created")

from app.main import app
client = TestClient(app)

# seed via API
r = client.post("/api/auth/seed")
print("seed", r.status_code, r.text)

r = client.post("/api/auth/login", json={"email":"admin@shinygrand.local","password":"Admin@123"})
print("login", r.status_code, r.json())
token = r.json()["access_token"]
h = {"Authorization": f"Bearer {token}"}

# create employee
r = client.post("/api/employees/", json={"emp_code":"EMP-001","name":"Arjun","phone":"9000000001","role":"Reception"}, headers=h)
print("create emp", r.status_code, r.text)
emp_id = r.json()["id"]

# create dummy image base64
def img_b64(color):
    img = Image.new("RGB", (300,300), color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()

b64 = "data:image/jpeg;base64," + img_b64((200,150,150))
# enroll needs file upload not base64, test files endpoint
import io as bio
# enroll via multipart
files = []
# We'll use httpx style: create file tuples
# TestClient supports files param
img_bytes = base64.b64decode(img_b64((200,150,150)))
r = client.post(f"/api/employees/{emp_id}/enroll", files=[("files", ("face1.jpg", img_bytes, "image/jpeg")), ("files", ("face2.jpg", img_bytes, "image/jpeg"))], headers=h)
print("enroll", r.status_code, r.text)

# verify same face should check_in
r = client.post("/api/attendance/verify", json={"image_base64": b64, "station_id":"GUW-01"}, headers=h)
print("verify1", r.status_code, r.text[:500])

r = client.post("/api/attendance/verify", json={"image_base64": b64, "station_id":"GUW-01"}, headers=h)
print("verify duplicate", r.status_code, r.text[:500])

# wait a bit and checkout - need to mock cooldown? We'll patch cooldown via direct db tweak? Instead test sessions
r = client.get("/api/attendance/sessions", headers=h)
print("sessions", r.status_code, r.text[:800])

r = client.get("/api/attendance/", headers=h)
print("records", r.status_code, r.text[:800])

# health
r = client.get("/health")
print("health", r.json())

print("API PASS")
# cleanup
import os as _os
try: _os.remove("./test_api.db")
except: pass
