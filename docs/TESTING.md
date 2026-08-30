# Testing Plan — Guwahati MVP

## Manual Tests (to run after `backend/run.ps1` + `frontend npm run dev`)

1. **Health:** `curl http://localhost:8000/health` → `{"ok":true}`
2. **Seed + Login:** POST `/api/auth/seed` then POST `/api/auth/login` with admin@shinygrand.local / Admin@123
3. **Create Employee:** POST `/api/employees/` with `EMP-001` Arjun → 200
4. **Enroll:** POST `/api/employees/{id}/enroll` with 3 photos (front, left, right) → enrolled 3, errors []
5. **Kiosk Pair:** Open `/kiosk` on PC → Pair Phone → QR → scan with phone → `/camera?token=...` → status connected
6. **Check-in:** Stand 1m, face center → green tick, `/admin` shows check_in at IST
7. **Duplicate:** Tap again within 60s → "Already marked"
8. **Checkout:** After 60s (or adjust cooldown), same face → checkout + duration
9. **Offline Queue:** Airplane mode on PC → kiosk shows "Queued" → reconnect → sync
10. **Export:** `/admin` → Export CSV

## Automated Tests

```bash
cd backend && .venv/bin/activate
python test_flow.py        # unit: embedding + duplicate + checkout
python test_api.py         # API: seed/login/enroll/verify/duplicate/sessions
```

Expected: PASS with distance 0 for same image, duplicate blocked, checkout 480 min.

## Accuracy Calibration (with real staff)

- Enroll all 15 employees (5 shots each, quality >0.6)
- For each employee: 10 genuine attempts (vary light/glasses/distance)
- Impostor: colleague tries to check in as other → FAR
- Tune `ATTENDANCE_THRESHOLD` 0.30-0.55 via admin slider until FAR <1% and TAR >95%
- Start at 0.42, adjust ±0.03

## Anti-Spoof Quick Test

- Print A4 photo → should get liveness flag amber (not hard block in MVP)
- Video replay on phone screen → similar amber

## Reliability

- Kill Wi-Fi mid-scan → queue
- Reboot PC → service auto-starts via nssm/pm2
- Phone battery dies → toggle to USB webcam

## Security

- No token → 401
- Expired station token → 401
- Replay queue item with bad HMAC → rejected (future)
