# Hotel Shiny Grand — Attendance System (Web Kiosk)

Web-only, zero-recurring-cost attendance for 15 staff, single station (GUW-01), Guwahati IST.
Phone as companion camera via QR + WebRTC (no webcam needed). MediaPipe detect (browser) + InsightFace ONNX verify (server).

## Stack
- **Frontend:** Next.js 14 (App Router, TypeScript, Tailwind) → Cloudflare Pages (free, unlimited BW, commercial allowed)
- **Backend:** FastAPI (Python 3.11) + onnxruntime + InsightFace buffalo_l + pgvector → self-host on Windows 10 via `cloudflared tunnel` OR Render Free
- **DB:** Neon Postgres Free (0.5GB, no pause, pgvector) — Supabase alternative supported
- **Time:** Server UTC authoritative, IST display `Asia/Kolkata`

## Windows 10 Quick Start (zero budget)
```powershell
# 1. Clone
git clone <repo> "Pagar Book" ; cd "Pagar Book"

# 2. Backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
copy backend\.env.example backend\.env   # edit DATABASE_URL, JWT_SECRET
python -m alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload  # from backend/

# 3. Frontend (new terminal)
cd frontend
npm install
copy .env.example .env.local
npm run dev  # http://localhost:3000

# 4. Cloudflare Tunnel (expose backend securely, no port forward)
cloudflared tunnel --url http://localhost:8000
```

## Project Structure
```
backend/
  app/
    main.py          # FastAPI app
    core/            # config, security, time
    models/          # SQLAlchemy
    api/             # routes
    services/        # face, attendance state machine
  migrations/        # Alembic
  requirements.txt
frontend/
  app/
    (kiosk)/         # /kiosk, /camera/[token], /admin/*
  components/
  lib/               # webrtc, offline queue (idb)
```

## Key URLs
- `/kiosk` — full-screen attendance (PC)
- `/camera/[token]` — phone companion (scan QR)
- `/admin` — dashboard (protected)

## Env Vars
See `backend/.env.example` and `frontend/.env.example`.

## Privacy (India DPDP Act 2023)
- Store embeddings (VECTOR 512), delete raw crops after verify (or 7d encrypted if you opt-in).
- Provide PIN fallback for declining staff, show privacy notice at enrollment.
- See `docs/PRIVACY.md`.

## Cost
₹0/month on free tiers (Cloudflare Pages + Neon + Tunnel on already-on PC). Optional USB webcam ~₹1,500.
