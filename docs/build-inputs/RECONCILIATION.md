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
