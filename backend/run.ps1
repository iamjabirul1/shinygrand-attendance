# Windows 10 PowerShell starter for Hotel Shiny Grand
# Run from backend folder
$ErrorActionPreference = "Stop"
Write-Host "=== Hotel Shiny Grand Attendance — Windows Startup ===" -ForegroundColor Cyan

# 1. Create venv if missing
if (-not (Test-Path ".venv")) {
  python -m venv .venv
  Write-Host "Created .venv"
}
. .\.venv\Scripts\Activate.ps1
python -m pip install -q --upgrade pip
pip install -q -r requirements.txt
pip install -q "bcrypt==4.0.1"

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env — EDIT DATABASE_URL and JWT_SECRET!" -ForegroundColor Yellow
}

# 2. DB migrate (sqlite fallback if no postgres)
Write-Host "Migrating DB..."
python -c "from app.core.db import Base, engine; Base.metadata.create_all(bind=engine); print('DB ready:', engine.url)"

# 3. Seed admin if needed
Write-Host "Seeding admin..."
python -c "from app.core.db import SessionLocal; from app.models.models import User; from app.core.security import hash_password; from app.core.time import now_utc; import uuid; db=SessionLocal(); exists=db.query(User).first(); print('exists', exists.email if exists else 'none'); 
if not exists:
    u=User(id=str(uuid.uuid4()), email='admin@shinygrand.local', password_hash=hash_password('Admin@123'), role='admin', created_at=now_utc())
    db.add(u); db.commit(); print('seeded admin@shinygrand.local / Admin@123')
else:
    print('already seeded')"

Write-Host "Starting API on http://0.0.0.0:8000 — press Ctrl+C to stop" -ForegroundColor Green
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
