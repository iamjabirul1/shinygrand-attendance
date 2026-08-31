from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./shinygrand.db"  # override via Neon for cloud: postgresql+psycopg://...
    JWT_SECRET: str = "dev-change-me-please-32-chars-long!!"
    JWT_EXPIRES_MINUTES: int = 43200  # 30 days (hotel kiosk shouldn't expire every 15 min)
    JWT_REFRESH_DAYS: int = 30
    STATION_TOKEN_EXPIRES_MINUTES: int = 43200  # 30 days for dedicated hotel phone
    ATTENDANCE_THRESHOLD: float = 0.42  # cosine distance threshold (lower=stricter). 0.42 ~ 0.58 similarity
    ATTENDANCE_COOLDOWN_SECONDS: int = 60
    CORS_ORIGINS: str = "http://localhost:3000,https://*.pages.dev,https://*.vercel.app,https://*.onrender.com,https://shinygrand-attendance.vercel.app,https://shinygrand-attendance-api.vercel.app"
    INSIGHTFACE_MODEL_DIR: str = "./onnx_models"
    EMBEDDING_DIM: int = 512
    TZ: str = "Asia/Kolkata"

    class Config:
        env_file = ".env"
        extra = "ignore"

@lru_cache
def get_settings() -> Settings:
    return Settings()
