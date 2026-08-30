#!/bin/sh
set -e
echo "=== ShinyGrand API start ==="
echo "DATABASE_URL=$DATABASE_URL" | sed 's/:[^:]*@/:***@/g'
# Wait for DB (max 30s)
if echo "$DATABASE_URL" | grep -qi "postgresql"; then
  echo "Postgres detected — running migrations..."
  # Try alembic upgrade, fallback to create_all if alembic fails (e.g., no DB yet)
  python -m alembic upgrade head || python -c "from app.core.db import Base, engine; Base.metadata.create_all(bind=engine); print('fallback create_all done')"
else
  echo "SQLite detected — create_all..."
  python -c "from app.core.db import Base, engine; Base.metadata.create_all(bind=engine); print('sqlite create_all done')"
fi
# Seed default station GUW-01 if missing (idempotent)
python -c "from app.core.db import SessionLocal; from app.models.models import Station; from app.core.time import now_utc; db=SessionLocal(); s=db.get(Station,'GUW-01'); 
if not s:
    s=Station(id='GUW-01', name='Reception', is_active=True, created_at=now_utc())
    db.add(s); db.commit(); print('seeded GUW-01')
else:
    print('station GUW-01 exists')
db.close()" || true

echo "Starting uvicorn on 0.0.0.0:${PORT:-8000}"
exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1
