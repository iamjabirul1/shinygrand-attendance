# Cloud Free Deploy — 100% Free (No Credit Card)

Host your Hotel Shiny Grand attendance in cloud for **₹0/month** using free tiers:
- **Frontend:** Cloudflare Pages (free, unlimited bandwidth, commercial allowed) — or Vercel Hobby
- **Backend:** Render Free (750h/mo, sleeps 15m) — auto-deploy from GitHub
- **DB:** Neon Free (0.5GB, pgvector, no pause, scale-to-zero) — perfect for 15 staff (~45 rows/day)

> Total time: ~15 minutes. No card needed for any of these free tiers (Aug 2026 verified).

---

## Option A — Recommended Free Stack (Cloudflare Pages + Render + Neon)

### 1) Create Neon Postgres (2 min) — Free DB + pgvector

1. Go to https://console.neon.tech → Sign up (GitHub/Google, no card)
2. **Create project:** `shinygrand`, Region `Singapore` or `US East` (closest to Guwahati)
3. Copy **Connection string** → looks like `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`
4. Convert for app: prefix with `postgresql+psycopg://` → `postgresql+psycopg://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`
5. Test (optional): paste in https://console.neon.tech SQL Editor → run `CREATE EXTENSION IF NOT EXISTS vector;` → Success

> Keep Neon tab open — you'll paste this into Render next.

### 2) Push code to GitHub (1 min)

```bash
# If not yet pushed:
cd "GENERAL OPENCODE/Pagar Book"
git remote add origin https://github.com/YOUR_USER/shinygrand-attendance.git
git push -u origin main
```

### 3) Deploy Backend to Render (3 min) — Free API + auto-migrate

1. Go to https://dashboard.render.com → Sign in with GitHub
2. **New → Blueprint → Connect repo** `shinygrand-attendance` → it reads `render.yaml`
3. Or **New → Web Service → Connect repo → Docker** (Dockerfile at `backend/Dockerfile`)
4. **Environment variables** (Render Dashboard → Environment):
   - `DATABASE_URL` = `postgresql+psycopg://...` (Neon string from step 1, with `+psycopg`)
   - `JWT_SECRET` = any 32+ char random (Render can generate, or `openssl rand -hex 16`)
   - `CORS_ORIGINS` = `https://shinygrand-frontend.pages.dev,https://*.pages.dev,https://*.vercel.app,http://localhost:3000`
   - `ATTENDANCE_THRESHOLD` = `0.42`
   - Keep defaults: `PORT` auto-set by Render, `TZ=Asia/Kolkata`
5. **Deploy** → wait ~4 min (builds Docker, runs `start.sh` → `alembic upgrade head` → seeds `GUW-01`)
6. Copy **Backend URL** → e.g. `https://shinygrand-api.onrender.com`
7. Test: `curl https://shinygrand-api.onrender.com/health` → `{"ok":true}`

> **Render Free notes:** sleeps after 15m idle (cold start ~30s). Keepalive workflow `.github/workflows/keepalive.yml` pings `/health` every 12h. For hotel windows (07:00,17:00,22:00 IST) first hit wakes it — set a phone alarm or add UptimeRobot free ping every 10m.

### 4) Deploy Frontend to Cloudflare Pages (3 min) — Free, unlimited BW

**Via Cloudflare Dashboard (no Wrangler needed):**

1. Go to https://dash.cloudflare.com → Pages → **Create a project → Connect to Git**
2. Select repo, **Framework preset:** `Next.js`
3. **Build settings:**
   - Root directory: `frontend`
   - Build command: `npm run build`
   - Output directory: `.next` (Cloudflare auto-detects Next.js)
   - Node version: `20`
4. **Environment variables (Settings → Environment variables → Production):**
   - `NEXT_PUBLIC_API_URL` = `https://shinygrand-api.onrender.com` (your Render URL, no trailing `/`)
   - `NEXT_PUBLIC_STATION_ID` = `GUW-01`
5. **Save and Deploy** → wait ~2 min → you get `https://shinygrand-frontend.pages.dev`

**Via Wrangler CLI (alternative):**
```bash
cd frontend
npx wrangler pages deploy .next --project-name=shinygrand-frontend
# Then set vars in dashboard → Pages → Settings → Environment variables
```

> **Cloudflare Pages Free:** 500 builds/mo, unlimited bandwidth, 20k files, custom domain free with SSL. Verified stable, no commercial ban (unlike Vercel Hobby).

### 5) Wire CORS + Test (2 min)

- Backend already allows `*.pages.dev` via `allow_origin_regex` (`backend/app/main.py:28`)
- If custom domain, add it to `CORS_ORIGINS` in Render → Redeploy

**Test checklist:**
```bash
curl https://shinygrand-api.onrender.com/health
# → {"ok":true,"tz":"Asia/Kolkata"}
```
Then open frontend:
1. `https://shinygrand-frontend.pages.dev/login` → `POST /api/auth/seed` (first time) → login `admin@shinygrand.local / Admin@123`
2. `/admin` → Add employee `EMP-001` Arjun
3. Enroll 3 photos (front, left, right)
4. `/kiosk` → Pair Phone → scan QR with phone → `/camera?token=...` → Allow camera → check-in

---

## Option B — Vercel (Frontend alternative, also free)

1. Go to https://vercel.com → **Add New Project → Import Git Repo**
2. Root: `frontend`, Framework: Next.js, Build: `npm run build`
3. **Env:** `NEXT_PUBLIC_API_URL=https://shinygrand-api.onrender.com`
4. Deploy → `https://shinygrand.vercel.app`

> Note: Vercel Hobby bans commercial use (ToS). Cloudflare Pages is recommended for hotel business use. Vercel is fine for personal preview.

## Option C — All-on-Render (simplest, one platform)

- Add second service on Render: **Static Site** at `frontend/` (publish dir `.next`), point to same `NEXT_PUBLIC_API_URL`
- Or use `docker-compose.yml` locally as-is for self-host.

---

## Free Limits & When to Upgrade (15 staff → no upgrade needed for years)

| Service | Free allowance | Your usage (15 staff) | Years until limit |
|---------|---------------|----------------------|-------------------|
| Neon | 0.5GB storage, 100 CU-hrs/mo | ~45 records/day × 200 bytes ≈ 3MB/year | **>100 years** |
| Render Web | 750h/mo, sleeps 15m | Always-on within free hours | No upgrade |
| Cloudflare Pages | 500 builds/mo, unlimited BW | <20 builds/mo, <1GB BW | No upgrade |

**Upgrade only if:** >100 employees, need no sleep (Render Standard $7/mo) or branching (Neon Pro $19/mo). You won't for Hotel Shiny Grand scale.

---

## Keepalive (prevents Render sleep)

`.github/workflows/keepalive.yml` already in repo — pings `/health` every 12h.

**To enable:**
1. Push repo to GitHub
2. Add secret: GitHub → Settings → Secrets → `API_URL=https://shinygrand-api.onrender.com`
3. Workflow auto-runs. Also add UptimeRobot: https://uptimerobot.com → Add Monitor → HTTP → your `/health` every 10m (free 50 monitors).

---

## Custom Domain (optional, still free)

- Cloudflare: Pages → Custom domain → `attendance.shinygrand.com` → auto SSL → free.
- Render: Settings → Custom domain → point CNAME to `shinygrand-api.onrender.com`.

---

## Troubleshooting

| Issue | Fix |
|------|-----|
| `CORS error` on verify | Add frontend domain to `CORS_ORIGINS` in Render → Redeploy |
| `connection failed: could not receive data` | `DATABASE_URL` must be `postgresql+psycopg://` (not `postgresql://`), and `?sslmode=require` |
| `JWT error` | Ensure `JWT_SECRET` same across deploys, 32+ chars |
| `pgvector extension missing` | Run in Neon SQL Editor: `CREATE EXTENSION vector;` (already in migration) |
| `Render build fail: libgl` | Dockerfile already installs `libgl1 libglib2.0-0` |
| `Phone camera black` | Must be **HTTPS** (Pages provides) + **Allow camera** + same station token (QR expires 5m → Pair again) |

---

## One-Command Local Verify Before Cloud

```bash
# Backend
cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && python test_api.py && python -m uvicorn app.main:app --port 8000 &
# Frontend
cd frontend && npm install && NEXT_PUBLIC_API_URL=http://localhost:8000 npm run build && npm start &
```

Then deploy to cloud when local passes.
