# ADR-002: Single-Tenant Isolation and POPIA s57/s58 Gate

- **Status:** Accepted
- **Date:** 2026-11-25
- **Context:** Insurers require strict tenant separation in InfoSec reviews, and cross-insurer ID matching triggers POPIA s57/s58 prior authorisation and Competition Act governance.
- **Decision:**
  1. Phase 1 deploys logically/physically isolated single-tenant instances per insurer, reinforced by `org_id` scoping and PostgreSQL Row-Level Security (RLS) on every tenant table.
  2. Cross-insurer entity joins and Phase 3 Private Set Intersection (PSI) are disabled and locked in code until written Information Regulator authorisation and ASISA/Competition Act sign-off are recorded.
