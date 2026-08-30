# Deploy — Zero Budget

## Option B2 (Recommended for Guwahati offline resilience)
1. Frontend: push `frontend/` to Cloudflare Pages (connect GitHub repo, build `npm run build`, output `.next` via `next-on-pages` or `npm run build` + `pages` adapter).
   For MVP, easiest: `npx wrangler pages deploy frontend/out` after `next build` with `output: export` (or deploy to Vercel prod free if non-commercial dev only).
2. Backend on Windows 10 PC:
   ```
   cd backend
   python -m venv .venv && .\.venv\Scripts\activate
   pip install -r requirements.txt
   # .env: DATABASE_URL=neon or local docker db
   alembic upgrade head
   uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```
3. Tunnel:
   ```
   cloudflared tunnel --url http://localhost:8000
   # copy https://xxx.trycloudflare.com -> set NEXT_PUBLIC_API_URL in Cloudflare Pages env
   ```
4. For permanent tunnel: `cloudflared tunnel create shinygrand` + `cloudflared tunnel route dns shinygrand api.shinygrand.example.com` + `cloudflared tunnel run`.

## Pure cloud (no PC)
- DB: Neon free 0.5GB
- API: Render.com free (sleep 15m) — set `DATABASE_URL` env
- Frontend: Cloudflare Pages

## Keep-alive (if Supabase)
GitHub Action cron every 2 days: `curl $API/health`

## Windows service
Use `nssm install ShinyGrandAPI` + `nssm set AppDirectory ...` + `nssm set AppParameters ...` or `pm2` via `pm2-windows-startup`.
