#!/bin/bash
set -e
echo "=== Hotel Shiny Grand Attendance — Unix Starter ==="
if [ ! -d ".venv" ]; then python3 -m venv .venv; echo "Created .venv"; fi
source .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt
pip install -q "bcrypt==4.0.1"
[ -f .env ] || cp .env.example .env
echo "Migrating DB..."
python -c "from app.core.db import Base, engine; Base.metadata.create_all(bind=engine); print('DB ready', engine.url)"
echo "Seeding admin..."
python -c "from app.core.db import SessionLocal; from app.models.models import User; from app.core.security import hash_password; from app.core.time import now_utc; import uuid; db=SessionLocal(); exists=db.query(User).first(); 
if not exists:
    u=User(id=str(uuid.uuid4()), email='admin@shinygrand.local', password_hash=hash_password('Admin@123'), role='admin', created_at=now_utc())
    db.add(u); db.commit(); print('seeded admin@shinygrand.local / Admin@123')
else:
    print('already seeded')"
echo "Starting API on http://0.0.0.0:8000"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
