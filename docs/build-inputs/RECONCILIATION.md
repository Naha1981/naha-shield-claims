# Spec reconciliation log (working document, synthetic data only)

Canonical order: spec 3 (TC-DUP suite) is the engine's test source of truth; spec 4 is queued build input.
Where specs conflicted, the stricter value was kept and the conflict is listed here for Thabiso.

## Resolved in the engine (commit 12ffaa31)

1. Bank account score: spec 2 payload 88 vs spec 3 TC-DUP-005 92 -> kept 92.
2. Agent duplicate policy: spec 2 payload 82 vs spec 3 TC-DUP-011 85 -> kept 85.
3. Cross-insurer: spec 3 TC-DUP-020 table 95 vs spec 2 payload 97 -> kept 97.
4. Address/phone/device signals: spec 1 monitor-only-no-review, spec 2 payload 35/no review,
   spec 3 score 50/65 with human review -> kept spec 3 (higher scores + review required).
5. Fairness: spec 1 wanted human/peer review for informal-settlement addresses and high-volume
   agent/parlour books; spec 3 (newer, fairness section) says no_action / monitor_only.
   Adopted spec 3. Thabiso should know his newest spec relaxed these three.
6. Spec 3 internal: TC-DUP-027 demands 400 for missing insured_person but TC-DUP-016/017
   inputs omit it. Engine: 400 only when a claim has NO identifying data at all.
7. Spec 2 payloads folded into TC numbering (10.1>TC-001, 10.2>TC-005, 10.3>TC-011,
   10.4>TC-015, 10.5>TC-018, 10.6>TC-020).

## Spec 4 fuzzy bands vs spec 3 (reconciled; conflicts kept at spec 3, flagged)

- Bands 4.1 actions and review flags match the engine's per-type behaviour, EXCEPT:
  a) Band table says score 70-84 = risk High; spec 3 boundary tests TC-DUP-032/035 say 70 and
     84.9 = Medium. Kept spec 3 (Medium below 85). CONFLICT reported to Thabiso.
  b) Band table says score 0-39 = no human review; spec 3 TC-DUP-015 (50), 022 (30), 023 (35),
     044 (35), 045 (35) all require human review. Kept spec 3 (review required). CONFLICT reported.
- TC-FUZZ confidence expectations vs engine (kept spec 3's stricter/higher values):
  phone-only 0.55 vs engine 0.80; address-only 0.50 vs 0.65; device-only 0.60 vs 0.78;
  bank-only 0.85 vs 0.97. Spec 4 is higher for one-char-name 0.98 vs engine fuzzy 0.96, and
  exact ID 1.00 vs 0.99. Reported; engine unchanged until Thabiso picks.

## Spec 4 work still to build (queued after current order)

- TC-FUZZ-001..030: new signals same_dob_only (<0.30) and same_agent_only (0.45), and
  confidence adjustment for missing corroborating fields (016-030). Note spec 4 internal
  oddity: TC-FUZZ-030 (all fields missing except ID) = 0.95 while single missing fields = 0.75-0.90.
- k6 profiles (smoke/baseline/load/peak/stress/soak/burst) with p95/p99 targets, LOCAL only.
- Deterministic mock-data generator, seed 42.
- CI pipeline (free tier) running the suites.
- Test execution report template: placeholders only; real numbers only from tests we run.

## Spec 5 (ops artefacts) — saved, adapted, fixed

- Verbatim spec saved: docs/build-inputs/spec5-observability-tuning-chaos-runbook-terraform.md.
- Grafana dashboard JSON saved as a file only (free Grafana/Prometheus), validated as parseable
  JSON: docs/ops/grafana/nahashield-duplicate-matching.json. Not deployed anywhere.
- Chaos experiments and load-spike runbook saved under docs/ops/ as reference documents
  (staging/local only per the spec's own principles; no chaos ever runs against a live system).
- Terraform saved as docs/ops/terraform/main.tf, REFERENCE ONLY. It would cost real money if
  ever applied (EKS, RDS, MSK, ElastiCache, WAF). There is no AWS account and nothing was
  created or applied. It is never to be raised to Thabiso as an offer. Fixes applied to the
  saved copy:
  1. EKS API endpoint was internet-facing (endpoint_public_access = true) -> set to false.
  2. Hardcoded resource names (IAM roles, node group, subnet groups, RDS identifier, Redis,
     MSK cluster, log group, WAF) -> parameterised via var.name_prefix.
  3. S3 backend bucket/lock table names removed from the file; they are per-deployment
     -backend-config values and must never be committed.
- pg_trgm tuning applied to docs/claims-workspace-schema.sql, adapted: persons.full_name is
  encrypted in our schema, so trigram indexes/similarity target a separate lowercase
  full_name_search column, never plaintext. Duplicate-match tenant indexes already existed.
- Local engine: added trigramSimilarity() mirroring pg_trgm similarity() and use it next to the
  Levenshtein check for fuzzy name matching (docs and engine now use the same operator).

## Spec 6 (worked example content) - number reconciliations (28 Nov 2026)

- S6-1 Board "claims reviewed 12,480" vs scenario "12,000" -> 12,000 everywhere.
- S6-2 Board "claims paid 11,730" -> 11,940 (12,000 reviewed minus 60 declined), consistent with the scenario.
- S6-3 Board "claims cleared 11,410" vs scenario "claims cleared 120" -> they were two different counts. Now labelled distinctly: "cleared as legitimate (total) 11,940" (11,680 never flagged + 140 flagged not held + 120 held then cleared) and "held then cleared after review 120".
- S6-4 Board "claims declined 95" vs scenario "declined or reduced 60" -> 60 everywhere. Saved cases 95 -> 60; attribution classes 58/27/10 -> 37/17/6 (same proportions, sums to 60). All rand amounts unchanged; the fee table keys off rands, not counts.
- S6-5 Board "claims recovered 45" vs drill-down "recovered cases 18" -> 45 is wrongful payments FOUND; 18 is recovered cases (cash cleared the bank). Labels fixed.
- S6-6 ROI shown as both "5.34x" and "434%" -> same ratio two ways: net benefit R2,818,500 / fee R527,500 = 5.34x, which is a 434% return over the fee. Shown together with the relationship spelled out.
- S6-7 ASISA figures (R80.8m, 2,282 funeral claims in 2020, about R35,400 per case) verified against the cited ASISA media release page on 28 Nov 2026; shown with the source link.
- S6-8 Insurer "Pride Life SA" and all person names removed; insurer is a viewer-typed variable, people are neutral fictional roles. Fees/ROI labelled sample pricing, not an offer.

## Spec 7 (worked-case build artefacts) - adaptations (28 Nov 2026)

- S7-1 Next.js snippets adapted to this repo's Vite + internal state router; component names kept (WorkedCaseLanding, WorkedCaseSelector, ExecutiveValueBoard, CaseHeader, CaseTimeline, IndicatorPanel, EvidencePanel, DecisionPanel, ValuePanel, ShieldExplainer, WorkedCaseDetailPage). Routes kept as /see-worked-case-example and /see-worked-case-example/:caseId within the internal router.
- S7-2 His vitest + testing-library spec does not run in this repo (runner is tsx --test; no testing-library installed). Rewritten as node:test at his path tests/worked-cases/worked-cases.spec.ts, asserting the same things against the shared data module and the live API router; package.json test glob extended.
- S7-3 Case 2 decision date: spec 7 said 2026-06-09; spec 6 says declined after 5 business days from 5 June -> 2026-06-12 kept (stricter/more accurate).
- S7-4 Case 2 relationship: spec 7 "sister" vs spec 6 "claimant not immediate family" -> "cousin (not immediate family)" kept so the indicator is consistent.
- S7-5 Indicator "submitted one day after death" vs spec 6 dates (death 3 June, submitted 5 June) -> "within two days of death".
- S7-6 Indicator set is the union: spec 7's 8 plus spec 6's "claimant not immediate family" = 9.
- S7-7 All approver/person names replaced with neutral roles; insurer placeholder "Sample Insurer" served by the API; viewer-typed name only fills the landing page heading locally.

## Spec 4 build-out - TC-FUZZ reconciliations (28 Nov 2026)

- S4-FUZZ-001: TC-FUZZ-001 expects confidence 1.00 for an exact ID match; the spec 3 TC-DUP suite pins 0.99. Kept 0.99 (spec 3 pinned value).
- S4-FUZZ-002: TC-FUZZ-002 expects 0.98 for a one-character name difference with the same ID; spec 3 pins 0.96. Kept 0.96.
- S4-FUZZ-006/007/008/009: spec 4 expects 0.55 (phone), 0.50 (address), 0.60 (device), 0.85 (bank). The engine's spec 3 values are stricter: 0.80, 0.65, 0.78, 0.97. Kept the stricter values.
- S4-FUZZ-011/012: spec 4 expects 0.40 for parlour-only and doctor-only; the engine's spec 3 values are 0.35. Kept 0.35.
- S4-FUZZ-016..020: spec 4 differentiates name-variation confidence (0.85-0.95); the engine treats any close name variation with a matching ID+DOB as fuzzy_name_exact_id 0.96 (stricter). Kept 0.96.
- S4-FUZZ-021..030: spec 4 degrades confidence (0.75-0.95) when corroborating fields are missing; the engine keeps the exact-ID match at 0.99 (stricter). Kept 0.99.
- S4-FUZZ-005/010: two standalone signals spec 3 did not cover were ADDED: same_dob_only (0.25, low, no action) and same_agent_only (0.45, medium, monitor only).
- S4-GEN: his generator was not deterministic (wall-clock submitted_at and unseeded policy UUIDs). Fixed: seeded timestamps and UUIDs; two seed-42 runs now produce byte-identical output (proven with diff -r).
- S4-CI: his CI was Python/pytest; rewritten for this repo (npm ci, tsc, npm test incl. fuzz, vite build, generator determinism job). Thresholds kept from 3.3 (p95<1500ms, p99<3000ms, errors<1%, checks>99%) but flagged: they must be baselined from real local runs before tightening.
- S4-K6: k6 load/stress/soak scripts saved to load/k6/ with a hard guard that refuses any non-local BASE_URL. Local/synthetic only.
- S4-RPT: report template saved to docs/build-inputs/test-execution-report-template.md with a banner marking every example number a placeholder, never our results.
