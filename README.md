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

## Cloud Free Deploy — 15 min to live URL

Host on **₹0 cloud** (no card, no Tunnel PC needed):

**1. DB — Neon free:** https://console.neon.tech → Create project `shinygrand` → copy `postgresql+psycopg://...?sslmode=require`
**2. API — Render free:** https://dashboard.render.com → New Blueprint → connect repo (reads `render.yaml`) or New Web Service (Docker: `backend/Dockerfile`, env `DATABASE_URL` = Neon, `JWT_SECRET` = 32+ chars) → Deploy → copy `https://shinygrand-api.onrender.com` → test `/health`
**3. Web — Cloudflare Pages free:** https://dash.cloudflare.com → Pages → Connect Git → `frontend` → Build `npm run build` → Env `NEXT_PUBLIC_API_URL=https://shinygrand-api.onrender.com` → Deploy → `https://shinygrand-frontend.pages.dev`

Add UptimeRobot ping to `/health` every 10m to prevent Render sleep. Full step-by-step with screenshots: [docs/CLOUD_FREE.md](docs/CLOUD_FREE.md).

> Local also works forever: `backend/run.ps1` + `npm run dev`. Cloud is optional.

## Cost
₹0/month on free tiers (Cloudflare Pages + Neon + Render Free — 750h/mo, or Tunnel on already-on PC). Optional USB webcam ~₹1,500.
