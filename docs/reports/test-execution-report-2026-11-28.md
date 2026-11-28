# ClaimTrace Cross-Claim Matching + Connectors Test Execution Report

**Report ID:** TR-2026-11-28-001
**Build:** mega-rc @ 51237354 (on main 90df13c4 + docs 13cbdaaf)
**Environment:** Local production server (NODE_ENV=production, PORT=3100)
**Test date:** 28 November 2026
**Tester:** Instinct task agent
**Approver:** pending Thabiso Go+Sure

All values below are MEASURED on this build, per the template's rule.
Synthetic data only. Nothing released.

## 1. Executive summary

| Item | Result |
|---|---|
| Overall status | Pass |
| Unit + integration + worked-case + fuzz + connector tests | 257 / 257 pass |
| Typecheck (tsc --noEmit) | Pass |
| Production build (vite) | Pass |
| e2e intake (phone, dark) | Pass |
| e2e ingest (Excel, sample file) | Pass |
| WCAG AA contrast audit, both themes | Pass (all screens) |
| k6 load/stress/soak | Not run here — local-only suites in load/k6, thresholds p95 < 1500ms, p99 < 3000ms (need a scheduled local run) |
| bun.lock vs package.json (Railway bun install) | Consistent (esbuild 0.28.2 satisfies ^0.28.0) |

## 2. Scope of this build

- main 90df13c4 (ClaimTrace rename, live) + docs 13cbdaaf (domain front-door record).
- 7ce9e367: spec 4 build-out — TC-FUZZ-001..030 fuzz suite (17 test cases),
  deterministic seed-42 generator, k6 local profiles, ClaimTrace CI workflow,
  report template.
- 04008bc9: spec 1 + spec 2 saved verbatim into docs/build-inputs/;
  test-execution report template retitled ClaimTrace.
- 603c2466: connector framework — SIM swap, RICA, bank AVS adapters
  (13 test cases); consent gate (synthetic consent ref required);
  append-only audit log; single live switch LIVE_CONNECTORS_ENABLED=false
  that throws if flipped without real adapters; every output labelled
  SIMULATED with innocent explanation; human_decides on every indicator;
  no auto-reject, no send, no payment paths; worked-case page takes its
  SIM-swap and bank-account indicator text from the connectors module;
  ClaimTrace CI now runs on mega-rc.
- 51237354: executive deck produced as docs/deck/claimtrace-executive-deck.md
  (spec 7 s2 renamed; insurer/client variables; sample-labelled figures).

## 3. Already-built surface this RC sits on (verified present, tests green)

- Recovery action API: server/recoveryApi.ts, 16 endpoints (spec 1 s1),
  idempotency keys, X-Request-ID, object-level auth, cash recognised only
  after reconciliation clears, no auto-repudiation, webhooks recorded never
  dispatched. Tests: server/recoveryApi.test.ts.
- RBAC matrix: server/rbacMatrix.ts (spec 1 s5) + tests.
- False-flag incident response: docs/false-flag-incident-response.md +
  server/incidentControl.ts + tests (spec 1 s3).
- Claims workspace schema: docs/claims-workspace-schema.sql (spec 1 s2 /
  spec 2 s7), pg_trgm adaptation logged in RECONCILIATION.md.
- Cross-claim engine + TC-DUP suite: src/lib/engine/crossClaimMatching.ts +
  tests (spec 3), fuzz signals same_dob_only / same_agent_only live in the
  engine and fuzz tests.
- Communication templates: server/messageTemplates.ts + tests (spec 2 s8) —
  insurer name always a variable, drafts needing human approval, no send path.
- Worked-case example: pages + API + tests (spec 6/7), sample-labelled.
- Ops artefacts saved reference-only: Grafana JSON, chaos experiments,
  load-spike runbook, Terraform (never applied; would cost money).

## 4. Fairness position (for his awareness, from RECONCILIATION.md)

- Spec 3 (newest) relaxed three spec-1 fairness rules to no_action /
  monitor_only; the engine follows spec 3. He should confirm he wants the
  relaxed version: informal-settlement addresses and high-volume agent /
  parlour books no longer force human/peer review on their own.
- Engine keeps: humans decide every adverse action; every indicator carries
  an innocent explanation; nothing auto-rejects.

## 5. Known not-done (honest gaps)

- k6 profiles exist but were not executed in this run (need a local k6 binary
  and a timed run; scripts refuse non-local targets).
- Connectors have no screen of their own; they surface through indicator text
  and the worked-case example, per the order. A connectors/audit-log view is
  a candidate next item only if he wants one.
- Live connector calls: intentionally impossible while
  LIVE_CONNECTORS_ENABLED=false (no real telco/RICA/bank credentials exist;
  synthetic fixtures only).

## 6. Rollback

- RC is branch mega-rc; main is untouched by it. Release would be a merge of
  the listed commits after his Go+Sure. Rollback tag from before ingest work:
  rollback-2026-11-28-pre-claims-ingest (23c908a8).
- Domain move rollback (already live, approved): docs/ops/domain-front-door.md
  + docs/ops/nahalabs-app-proxy.worker.js.backup-2026-11-28-pre-claimtrace.
