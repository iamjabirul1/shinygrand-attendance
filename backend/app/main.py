from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .core.config import get_settings
from .api import auth, employees, stations, attendance, signal

settings = get_settings()

app = FastAPI(title="Hotel Shiny Grand Attendance API", version="1.0.0")

origins = [o.strip() for o in settings.CORS_ORIGINS.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"ok": True, "tz": settings.TZ}

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(employees.router, prefix="/api/employees", tags=["employees"])
app.include_router(stations.router, prefix="/api/stations", tags=["stations"])
app.include_router(attendance.router, prefix="/api/attendance", tags=["attendance"])
app.include_router(signal.router, tags=["signal"])
