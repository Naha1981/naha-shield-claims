# ADR-001: Hosting Region and South African Data Residency

- **Status:** Accepted for Phase 0/1 Demo (Production Gate Open)
- **Date:** 2026-11-25
- **Context:** ClaimTrace processes special personal information and financial recovery records for South African insurers under POPIA (including s72 transborder transfer constraints).
- **Decision:**
  1. Synthetic/demo environments (e.g., Render preview) MUST NEVER ingest real PII and must display a persistent non-intrusive residency banner.
  2. Production deployments MUST place all PII-touching compute, workflow timers, object storage, and PostgreSQL databases inside a verified South African region (e.g., AWS `af-south-1` Cape Town or Azure South Africa North).
  3. Edge CDN/WAF layers outside South Africa may serve static UI assets only and must never terminate or cache PII payloads.
