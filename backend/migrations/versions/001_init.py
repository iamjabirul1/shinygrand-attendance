"""init

Revision ID: 001
Revises: 
Create Date: 2026-08-30
"""
from alembic import op
import sqlalchemy as sa
import pgvector.sqlalchemy

revision = "001"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table("users",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="admin"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table("employees",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("emp_code", sa.String(length=32), nullable=False, unique=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("phone", sa.String(length=20)),
        sa.Column("role", sa.String(length=80)),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table("employee_embeddings",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("employee_id", sa.String(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
        sa.Column("embedding", pgvector.sqlalchemy.Vector(512)),
        sa.Column("quality_score", sa.Float()),
        sa.Column("capture_index", sa.SmallInteger()),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table("stations",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False, server_default="Reception"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("last_heartbeat", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table("attendance_sessions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("employee_id", sa.String(), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("check_in", sa.DateTime(timezone=True), nullable=False),
        sa.Column("check_out", sa.DateTime(timezone=True)),
        sa.Column("check_in_station", sa.String(length=32)),
        sa.Column("check_out_station", sa.String(length=32)),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_sessions_employee_status", "attendance_sessions", ["employee_id","status"])
    op.create_index("ix_sessions_check_in", "attendance_sessions", ["check_in"])
    op.create_table("attendance_records",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("session_id", sa.String(), sa.ForeignKey("attendance_sessions.id")),
        sa.Column("employee_id", sa.String(), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("server_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("client_time", sa.DateTime(timezone=True)),
        sa.Column("station_id", sa.String(length=32)),
        sa.Column("confidence", sa.Float()),
        sa.Column("liveness_score", sa.Float()),
        sa.Column("threshold", sa.Float()),
        sa.Column("is_corrected", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("was_offline", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("correction_reason", sa.Text()),
        sa.Column("corrected_by", sa.String(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_records_employee_time", "attendance_records", ["employee_id","server_time"])
    op.create_index("ix_records_server_time", "attendance_records", ["server_time"])
    op.create_table("audit_logs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("actor_id", sa.String(), sa.ForeignKey("users.id")),
        sa.Column("action", sa.String(length=80), nullable=False),
        sa.Column("entity", sa.String(length=80), nullable=False),
        sa.Column("entity_id", sa.String(length=80)),
        sa.Column("before", sa.Text()),
        sa.Column("after", sa.Text()),
        sa.Column("ip", sa.String(length=64)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_audit_created_at", "audit_logs", ["created_at"])
    op.execute("INSERT INTO stations (id, name, is_active, created_at) VALUES ('GUW-01', 'Reception', true, NOW()) ON CONFLICT DO NOTHING")

def downgrade():
    op.drop_table("audit_logs")
    op.drop_table("attendance_records")
    op.drop_table("attendance_sessions")
    op.drop_table("stations")
    op.drop_table("employee_embeddings")
    op.drop_table("employees")
    op.drop_table("users")
