import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, Text, ForeignKey, DateTime, Float, SmallInteger, Index, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
try:
    from pgvector.sqlalchemy import Vector
except:
    Vector = None
from ..core.db import Base
from ..core.config import get_settings
import json

def gen_uuid():
    return str(uuid.uuid4())

class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="admin")  # admin|manager
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class Employee(Base):
    __tablename__ = "employees"
    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    emp_code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)  # EMP-001
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20))
    role: Mapped[str | None] = mapped_column(String(80))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    embeddings: Mapped[list["EmployeeEmbedding"]] = relationship(back_populates="employee", cascade="all, delete-orphan")

def _embedding_col():
    s = get_settings()
    if s.DATABASE_URL.startswith("sqlite"):
        # sqlite: store as JSON text, handle cosine in python
        return mapped_column(Text)
    else:
        return mapped_column(Vector(512))

class EmployeeEmbedding(Base):
    __tablename__ = "employee_embeddings"
    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    employee_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False)
    embedding: Mapped[list[float]] = _embedding_col()
    quality_score: Mapped[float | None] = mapped_column(Float)
    capture_index: Mapped[int | None] = mapped_column(SmallInteger)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    employee: Mapped[Employee] = relationship(back_populates="embeddings")

class Station(Base):
    __tablename__ = "stations"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # GUW-01
    name: Mapped[str] = mapped_column(String(120), default="Reception")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_heartbeat: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class AttendanceSession(Base):
    __tablename__ = "attendance_sessions"
    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    employee_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("employees.id"), nullable=False, index=True)
    check_in: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    check_out: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    check_in_station: Mapped[str | None] = mapped_column(String(32))
    check_out_station: Mapped[str | None] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(20), default="open")  # open|closed|auto_closed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_sessions_employee_status", "employee_id", "status"),
        Index("ix_sessions_check_in", "check_in"),
    )

class AttendanceRecord(Base):
    __tablename__ = "attendance_records"
    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    session_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("attendance_sessions.id"))
    employee_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("employees.id"), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)  # check_in|check_out|correction
    server_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    client_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    station_id: Mapped[str | None] = mapped_column(String(32))
    confidence: Mapped[float | None] = mapped_column(Float)
    liveness_score: Mapped[float | None] = mapped_column(Float)
    threshold: Mapped[float | None] = mapped_column(Float)
    is_corrected: Mapped[bool] = mapped_column(Boolean, default=False)
    was_offline: Mapped[bool] = mapped_column(Boolean, default=False)
    correction_reason: Mapped[str | None] = mapped_column(Text)
    corrected_by: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    actor_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    entity: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(80))
    before: Mapped[dict | None] = mapped_column(Text)  # JSON string
    after: Mapped[dict | None] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
