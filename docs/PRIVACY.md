# Privacy Notice — Hotel Shiny Grand Attendance (DPDP Act 2023)

**Data Fiduciary:** Hotel Shiny Grand, Guwahati, Assam
**Purpose:** Recording check-in/out times for payroll/attendance
**Data collected:** Name, emp_code, phone, role, face embeddings (512 floats), attendance timestamps, station id, confidence, audit logs. Raw face crops are deleted immediately after embedding extraction (or after 7 days encrypted if you enable dispute retention).
**Legal basis:** Section 7(i) Legitimate Use (employment) + notice. Consent alternative: PIN-based check-in offered for any employee declining face.
**Retention:** Embeddings until employment ends +30 days; attendance 7 years; audit immutable.
**Rights:** Access, correct, delete embedding, withdraw face method (switch to PIN). Contact grievance: admin@shinygrand.local
**Security:** TLS, pgcrypto at-rest, JWT 15m, station-scoped tokens, WebRTC E2EE, rate limit, audit trail.
**Processors:** Neon/Cloudflare (DPA required), no cross-border transfer beyond India without notice.
**Withdrawal:** Ask admin to deactivate face and switch to PIN; attendance history remains anonymized if required.
