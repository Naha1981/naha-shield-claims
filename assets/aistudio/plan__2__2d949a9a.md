# ClaimTrace — Build Plan (`plan.md`)

| | |
|---|---|
| **Product** | ClaimTrace — Insurance Integrity, Consent & Recovery Intelligence Platform |
| **Company** | NahaLabs (Pty) Ltd |
| **Jurisdiction** | Republic of South Africa (data subjects, insurers, regulators) |
| **Basis** | PRD v1.0 (25 Nov 2026), UX/deliverables brief, ROI proof brief, PRD v0.1 |
| **Companion files** | `execution-plan.md` (who/when/gates) · `NahaShield_ROI_Evidence_Model_v1.0.xlsx` (executable spec for NRV, ledger, consent audit, KPIs) |
| **Status** | Draft for build kickoff — 25 Nov 2026 |

> **Integrity rule that governs everything below:** no customer results exist. Every target is a hypothesis until the signed ledger says otherwise. The software must make it *hard* to overclaim.

---

## 1. What we are building

One integration-first evidence platform that owns the two edges incumbents leave open:

- **Upstream (before cover is issued or changed):** independent proof that the life assured knows about and consented to third-party cover.
- **Downstream (after a fraudulent payout):** an honest separation of *paper* ownership from *legally accessible cash*, so insurers stop spending R50k+ chasing R0 defendants.

Both feed a **dual-signed Savings & Recovery Ledger** that proves value in bank-reconciled Rands.

| Module | What it is | Phase | Primary buyer |
|---|---|---|---|
| **C1** Core | Tenant isolation, append-only evidence vault, evidence-strength taxonomy, intra-book entity resolution, human-in-the-loop, dual-signed ledger | 1A | CFO, CRO |
| **M1** Recovery Desk | Confirmed-loss register, 8-layer asset/tenure profile, NRV calculator, Rule 46A / PTO flags, legal route matrix, cash reconciliation | 1A | Head of Forensics, Head of Legal Recoveries |
| **M2** Consent & Cover Integrity | Independent contact check, 2-tier consent ladder, silent duress, policy-event alerts, own-book stacking, PPR 2A.8.3 question audit | 1B | Head of Underwriting, CRO |
| **M3** Claims & Channel Integrity | Death-event triangulation, forged-template hash library, PPR 2+14 timers, AVS-R pre-EFT gate, voluntary parlour check, AgentShield | 2 | Head of Forensics, Claims |
| **M4** Cross-insurer PSI | Zero-PII private-set-intersection stacking check | 3 (gated) | Consortium |

**Not building:** a generic claims-scoring engine (XTND / Astute / Dark Pools own it), anything that auto-declines or auto-repudiates, direct DHA/bank/telco access, a consumer-facing product, underwriting or pricing.

---

## 2. Decisions and polish applied to the PRD

These are choices I made while turning the PRD into a plan. Items marked **CHANGE** deviate from PRD wording; items marked **CONFIRM** need your call or counsel's.

| # | Decision | Why |
|---|---|---|
| D1 | **M1 first, as the PRD says.** | Needs no real-time integration, works on batch exports, and Phase 0 can run on synthetic data. Fastest route to a signed ledger. |
| D2 | **CHANGE — single-tenant deployment per insurer in Phase 1; keep Postgres RLS inside it as defence in depth.** | The PRD asks for per-insurer RLS. With one insurer in Phase 1, separate infrastructure is simpler to defend in an InfoSec review and removes cross-tenant leak risk. Revisit for Phase 3. |
| D3 | **CONFIRM — keep all PII-touching compute and storage in a South African region.** The PRD's stack puts workflow timers on Cloudflare Workers / Durable Objects. Verify whether that platform can guarantee SA residency; if not, run timers and workflows beside the database in an SA region and use Cloudflare only for the static console and WAF. | POPIA obligations and insurer contracts. Residency is a hard gate, not a preference. |
| D4 | **CONFIRM with counsel — cross-border operator risk.** If NahaLabs (Pty) Ltd is the Lesotho entity, the insurer (responsible party) is sending South African personal information to an operator outside South Africa. Ask counsel whether POPIA's transborder rules apply and whether an SA-registered operator entity, or access only inside the insurer's SA environment, is needed. | This can block the first contract. Raise it in Week 1, not at contract stage. |
| D5 | **Rules-first.** Deterministic, versioned rules + intra-book graph in v1; supervised ML only on time-split, human-confirmed labels; LLMs only for timelines and drafts. | Explainability (POPIA s71, FSCA/PA AI governance), and there are no labels yet. |
| D6 | **The workbook is the executable spec.** NRV, route logic, ledger counting rules and consent tiering are written as formulas in the `.xlsx`; code must reproduce its outputs on the same inputs. | One source of truth; gives you ready-made acceptance tests. |
| D7 | **Phase 0 engine = Phase 1A code**, not a throwaway demo (library + CLI first, UI second). | Solo builder: nothing gets built twice. |
| D8 | **WhatsApp first, USSD/IVR second** for M2 delivery. | WhatsApp template approval has lead time; feature-phone coverage still matters for funeral cover, so USSD/IVR is a late-1B item, not dropped. Validate with the sponsor's channel mix. |
| D9 | **Normalise form names in all artefacts** (`BI-1663`, `DHA-1663`, `DHA-1680` are used inconsistently across the PRD and briefs). | Avoid embarrassing errors in front of claims teams. Confirm the correct codes with the sponsor. |
| D10 | **Phase 0 runs 6 weeks, not 4.** | The South African year-end shutdown will stall sponsor access from mid-December. |

---

## 3. Scope by phase

| Phase | In scope | Explicitly out of scope |
|---|---|---|
| **0** (wk 1–6) | Synthetic/de-identified 20–50 recovery cases through the NRV engine; historical third-party consent-gap audit; Phase 0 readout ("R lost / R collectable / R wasted") | Real PII; live integration |
| **1A** (wk 7–19) | C1 + M1: loss register, evidence vault, asset/tenure triage, route card, deadline warnings, cash reconciliation, signed ledger | Live claims integration; automated filings of any kind |
| **1B** (wk 11–23) | M2: consent ladder, duress block, alerts, own-book stacking, 2A.8.3 audit | Biometrics as default; cross-insurer stacking |
| **2** (wk 20–45) | M3: triangulation, hash library, 2+14 timers, AVS-R gate, voluntary parlour check, AgentShield; ML v2 evaluation | Forced parlour payout; score-driven escrow |
| **3** (wk 46+, gated) | M4 design spikes; ASISA working-group engagement | Production cross-insurer matching before **POPIA s57/58 authorisation** |

---

## 4. Architecture

```
                   ┌─────────────────────────────────────────────┐
                   │  Console (Investigator · Recovery · Exec)   │  static assets (CDN) + SSO
                   └───────────────────────┬─────────────────────┘
                                           │ HTTPS (SA-region API)
 ┌─────────────────────────────────────────▼────────────────────────────────────────────┐
 │  API / Application services  (TypeScript)                                              │
 │  Cases · Evidence · Triage · Routes · Consent · Claims · Timers · Ledger · Reporting  │
 ├───────────────┬──────────────┬──────────────┬───────────────┬──────────────┬─────────┤
 │ Rules engine  │ NRV / route  │ Consent      │ Timer service │ Doc-hash     │ LLM     │
 │ (versioned)   │ engine       │ orchestrator │ (biz-day cal.)│ service      │ gateway │
 └───────┬───────┴──────┬───────┴──────┬───────┴───────┬───────┴──────┬───────┴────┬────┘
         │              │              │               │              │            │
 ┌───────▼──────────────▼──────────────▼───────────────▼──────────────▼───┐   ┌────▼─────┐
 │ PostgreSQL (SA region): relational + append-only evidence vault +      │   │ Summarise │
 │ hash-chain + ledger events + audit log   · RLS as defence in depth     │   │ / draft   │
 └───────▲──────────────────────────────────────────────▲─────────────────┘   │ only      │
         │ object store (SA region, encrypted)           │                     └───────────┘
 ┌───────┴──────────────────────────────────────────────┴──────────────────────────────┐
 │ Adapters — insurer-sponsored credentials ONLY                                        │
 │ Batch import (Phase 0/1A) · Deeds/CIPC/bureau · Astute · XTND/ICB exports ·          │
 │ WinDeed/VerifyNow · AVS-R/DebiCheck · WhatsApp/USSD/IVR gateway · SSO               │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

**Design rules**

1. **Append-only evidence.** Evidence items are insert-only and hash-chained (`chain_hash = H(prev_hash ‖ content_hash ‖ metadata)`); a nightly verifier fails closed on any break.
2. **Every claim carries an evidence tag**: `Verified Fact | Documented Allegation | Inference | Hypothesis | Unknown`. Enum + `NOT NULL`; the UI cannot save without it.
3. **No decision without a named human.** Decline, dispute, repudiation and litigation steps are separate tables that require `reviewer_id`, `objective_reasons[]`, and `decided_at`. No code path writes them from a rule or model.
4. **Rules are data, not code.** Versioned JSON/YAML with thresholds per insurer; every flag stores rule ID + version + inputs + plain-language reason code.
5. **Adapters are credential-scoped.** One adapter inventory, signed by the DPO. No scraping, no backdoors.
6. **Workflow clocks are first-class.** Business-day calendar service (SA public holidays) with a visible countdown on every claim and a timer-accuracy test suite.
7. **Everything reproducible.** Any score, NRV or ledger figure can be recomputed "as at" a date from stored inputs and the rule/model version.

---

## 5. Core data model

| Table / aggregate | Purpose | Key fields |
|---|---|---|
| `org_config`, `users`, `roles` | Insurer config, RBAC, SSO mapping | role ∈ {investigator, recovery, underwriter, assessor, compliance, finance, exec} |
| `data_sources` | Lawful-basis register per feed | source, lawful_basis, retention, DPO sign-off |
| `evidence_items` | Append-only vault | id, case_id, sha256, prev_hash, chain_hash, uploader_id, ts, **evidence_tag**, custody_log |
| `entities`, `entity_links` | Intra-book graph: persons, phones, devices, accounts, beneficiaries, agents, doctors, parlours | entity_type, confidence, source_evidence_id |
| `loss_register` | Confirmed fraudulent payouts | payout, payout_date, policy/claim id, recipient bank (AVS/EFT), fraud basis, owner, ageing |
| `asset_profiles` | 8 value layers per defendant | registered, legal, beneficial owner; market, forced-sale, NRV, legally accessible, practically recoverable |
| `nrv_runs` | Frozen inputs + outputs + engine version | proceeds, bonds, arrears, costs, flags, NRV low/high |
| `route_recommendations` | Matrix output; never a decision | route, warnings (s300(5)(b)), reviewer, counsel_note |
| `recovery_events` | Demands, orders, instalments, costs, bank receipts | type, amount, bank_reconciled |
| `ledger_entries` + `ledger_signoffs` | Counting-rule engine and dual sign-off | basis (live/backtest), flags, amounts, forensic_signoff, finance_signoff |
| `policy_events`, `consent_requests`, `consent_certificates` | M2 | trigger, tier, channel, language, comprehension_result, duress_flag, cert_hash |
| `contact_verifications` | Anti-burner-SIM | source (CRM / KYC / bureau), independent (bool), status |
| `claims`, `claim_timers`, `dispute_notices` | M3 | 2-day and 14-day clocks, deferment reason, neutral notice id |
| `doc_hashes` | Zero-PII forged-template library | doc_type, perceptual_hash, structural_hash, status |
| `flags`, `reason_codes`, `decisions` | Explainability + human decisions | rule_id@version, reason text, reviewer_id |
| `audit_log` | Every read/write of sensitive data | actor, action, object, ts |

---

## 6. Core engine specifications

### 6.1 NRV and tenure engine (M1) — mirrors `Recovery_Triage`
```
accessible        = 0 if title ∈ {Communal/PTO, None} else 1
forced_sale       = accessible × proceeds × (1 − forced_sale_discount)
NRV_low           = accessible × (proceeds×(1−fsd) − bonds − arrears − costs)
NRV_high          = accessible × (proceeds − bonds − arrears − costs)
conservative_eq   = accessible × (proceeds×(1−fsd) − bonds − arrears)
early_write_off   = costs > conservative_eq
practically_recov = min(payout, max(NRV_low, 0))
flags             = Rule46A if title ∈ {Freehold, Sectional} and primary_residence
                    IPILRA/PTO if title = Communal/PTO
```
All eight value layers are stored; the workbook shows the five that drive routing.

### 6.2 Route decision order (guides counsel, never replaces counsel)
1. `early_write_off` → **Emoluments Attachment / CPA s297** if salaried, else **Early Write-Off memo**.
2. Else if `NRV_low ≥ payout` → **Civil delict (Masindi wording check) + CPA s300**, with the **60-day s300(5)(b) civil-bar warning** and forum suggestion (District ≤R300k, Regional ≤R1m, High Court above).
3. Else → **Civil delict + structured settlement**.
4. Independently: `ring_flag` → **state-referral pack** (MLRO FIC s29/s34; NDPP/AFU POCA s38). Never an automated freeze.
5. Rule 46A flag adds a reserve-price / unsold-auction delay assumption to the NRV timeline.

### 6.3 Ledger counting rules (software-enforced; mirrors `Ledger`)
- **Protected (live)** counts only if: flagged by ClaimTrace *before* payout/issuance **and** existing controls had *not* flagged it **and** a human confirmed the outcome **and** Head of Forensics **and** Finance both signed. Cancelled unauthorised policies book at an agreed **booking factor**, not full cover.
- **Backtest** values are stored in a separate column and labelled *would have protected*.
- **Net cash recovered** = bank-reconciled receipt − legal/tracing/sheriff cost. Judgments, orders, arrests and repayment promises never count.
- **Futile spend avoided** counts only when triage halted litigation and the outcome is confirmed and signed.
- Every cleared false positive logs review hours, delay days and cost.
- Language label is derived by formula: *exposure* → *would have protected* → *protected / recovered*. The UI cannot display a stronger label than the data supports.

### 6.4 Consent ladder (M2) — state machine
```
TRIGGER (proposer≠assured OR payer≠assured; or cover increase / accidental multiplier / beneficiary change)
  → CONTACT_INDEPENDENCE_CHECK
        independent number found  → CONSENT_REQUEST (Standard)
        none found                → "Contact Independence Unverified — Escalate" (human queue)
  → TIER: Escalated if (proposer≠assured≠payer) OR cover spike OR ≥N unrelated lives per payer
                    OR non-immediate beneficiary          [never age]
  → CONSENT_REQUEST (out-of-band, user's language: proposer, amount, multiplier, beneficiary)
        Confirm + comprehension answer → CERTIFICATE (hash to vault)
        Decline / Unrecognised         → PAUSE for underwriter review
        Silent Duress ("Not me")       → benign error screen + silent high-priority alert
        No response                    → Unreachable → human decision
  → Escalated adds: recorded callback OR opt-in POPIA-consented liveness (non-biometric fallback mandatory)
```
Messages are lint-checked against a tipping-off phrase list (FIC s29(4)/s53) and approved by counsel before use.

### 6.5 Timer service (M3)
- Business-day calendar with SA public holidays; **2-business-day** decision clock (Rule 2A.8.1) starts at claim receipt.
- **14-business-day** dispute opens only with an objective discrepancy, a named assessor and a Basdeo-compliant notice (stated reason + end date; no indefinite holds).
- FIC s29 clock is advisory to the insurer's MLRO only; ClaimTrace never files an STR.

### 6.6 Rules v1 starter catalogue (thresholds are per-insurer parameters, never hard-coded)
| Module | Rules |
|---|---|
| M2 | proposer≠assured · payer≠assured · contact not independent · cover spike · accidental multiplier added post-issue · beneficiary swap · same payer funding ≥N unrelated lives · non-immediate beneficiary · same-ID stacking (own book) · DebiCheck payer anomaly |
| M3 | registration-lag outlier vs bureau baseline · informant≠family · word-of-mouth ID (box 2.4) · outlier DHA office · certifier status / concentration · parlour concentration & velocity · short inception-to-death interval · forged-template hash match · AVS-R mismatch · agent early-lapse churn · shared phone/bank/device across unrelated policyholders · DebiCheck mandate mismatch |
| M1 | communal/PTO · Rule 46A · senior-bond coverage · arrears · salaried (emoluments eligible) · ring flag |

### 6.7 Forged-template hash library
Perceptual + structural hashes of BI-1663 / ID / executorship layouts; store hashes and layout metadata only. **No raw customer PII leaves a tenant.** Match = a reason code for a human, not a decision.

---

## 7. Integrations

| Adapter | Phase | Mode | Credential owner | Degrades to |
|---|---|---|---|---|
| Batch CSV/XLSX import | 0 / 1A | File | Insurer | Manual upload |
| Deeds / CIPC / credit-bureau traces (e.g., WinDeed) | 1A | Batch → API | Insurer (permissible purpose) | Manual trace upload |
| CRM / KYC contact feeds | 1B | API / export | Insurer | "Contact Independence Unverified" |
| WhatsApp Business gateway | 1B | API | NahaLabs + insurer sender ID | Callback queue |
| USSD / IVR aggregator | late 1B | API | NahaLabs | WhatsApp / callback |
| Astute, XTND / ICB exports, WinDeed / VerifyNow | 2 | Export / API | Insurer | Manual entry of signal |
| BankservAfrica AVS-R / DebiCheck | 2 | API | Insurer | Manual verification step |
| SSO (insurer IdP) | 1A | OIDC / SAML | Insurer | Local accounts (pilot only) |

---

## 8. Security, privacy and compliance implementation

The 20 guardrails in the workbook's `Compliance` sheet are the checklist. Highest-impact controls:

- **POPIA s71:** no auto-decisions (enforced in schema and code review).
- **PPR 2A.8 / 2A.10:** timers, Basdeo notices, no forced parlour payout.
- **FIC s29(4)/s53:** neutral comms with phrase lint.
- **POPIA s26/s32, PEPUDA:** biometrics opt-in; tier rules objective and age-free; fairness test across age bands.
- **POPIA s57/58 + Competition Act:** M4 behind a locked flag; no cross-tenant joins exist in code until written authorisation is on file.
- **Security:** encryption in transit/at rest, RBAC, SSO, secrets management, ISO 27001-aligned controls, penetration test before go-live.
- **Fairness:** feature allow-list; no race, ethnicity, language, surname or clan proxies; quarterly disparity review by geography and product.

---

## 9. Test and acceptance strategy

| Layer | What | Pass criterion |
|---|---|---|
| Unit | NRV, route, ledger, tier logic | Reproduces workbook outputs exactly on all 24 synthetic cases, 13 ledger rows and 30 consent rows |
| Property | Ledger | No input combination counts an unsigned, unconfirmed, non-incremental or non-reconciled amount |
| Timer | 2+14 clocks | Correct across weekends and SA public holidays |
| Security | Tenant isolation, evidence tamper, RBAC | Tamper test fails closed; cross-role access denied |
| Safety | Duress flow, tipping-off lint | Duress screen indistinguishable from an ordinary error; no banned phrase ships |
| Fairness | Tiering across age and language | Identical outcomes for identical structural facts |
| Adversarial | AI-forged documents, voice impersonation, synthetic images | Documented detection rates and known gaps |
| Scale (Phase 2) | 300,000 claims/year at 3× Aug–Jan peak | ≥90% of intake checks scored within 4 hours |
| UAT | Sponsor users on de-identified data | Pilot KPIs in `Pilot` sheet reach PASS |

---

## 10. Top risks

| Risk | Impact | Mitigation |
|---|---|---|
| Cross-border / operator status blocks contract (D4) | Delays first deal | Counsel Week 1; consider SA entity or in-environment access |
| Sponsor access stalls over year-end | Phase 0 slips | Build and demo on synthetic data; schedule readout for first week of January |
| Existing tools already cover the workflow (kill criterion K-03) | No measurable delta | Map handoff gaps in Discovery D-04 before scoping |
| Economics weak at low volume (workbook: Conservative case does not break even; M2 and M3 are negative at Base on direct Rands) | Pricing pressure | Sell M1 as the Rand case; sell M2 as regulatory/NFO risk; price M3 per-claim fees and pass-through carefully |
| False positives hurt families | NFO complaints, reputational damage | Tiering, human review, delay tracking, ≤1.0% cap |
| WhatsApp template approval / channel reach | M2 slips | Submit templates early; build callback fallback; USSD/IVR second |
| Incumbent moves upstream | Moat erodes | Move first on consent ledger; integrate rather than compete |
| Solo-builder capacity | Schedule slip | Cut line in `execution-plan.md` §10 |

---

## 11. Open items and document inconsistencies to resolve

1. **Murder-trial details differ:** PRD v0.1 says six victims; the v1.0 brief says nine murders / 29 policies. Obtain the primary report before quoting.
2. **XTND figures differ:** R244.6m repudiated (v1.0 brief) vs >R100m prevented (v0.1). Quote neither externally.
3. **Form naming:** `BI-1663` vs `DHA-1663` vs `DHA-1680`.
4. **Astute rule dated Jan 2018:** verify current 2026 Life Register behaviour.
5. **Primary documents still to obtain:** NFO statement (21 Sep 2026), Mbane/Msome judgment, ASISA March 2026 Guideline (cl. 6.15–6.16), PPR Rules 2A.8 / 2A.10.
6. **FIC s29 15-working-day clock:** confirm definition with counsel; it must remain advisory.
7. **Booking factor for cancelled unauthorised policies:** the workbook uses 10% as a placeholder; the CFO must set it.
8. **Success-share pricing:** subject to legal fee-sharing review.

---

## 12. Repository and build conventions (for AI-assisted delivery)

```
nahashield/
├─ docs/            plan.md · execution-plan.md · spec/NahaShield_ROI_Evidence_Model_v1.0.xlsx · adr/
├─ packages/
│  ├─ engine/       NRV · routes · ledger · consent tiers · timers   (pure functions, no I/O)
│  ├─ rules/        versioned rule packs (JSON/YAML) + tests
│  ├─ api/          services, auth, audit
│  ├─ adapters/     one folder per integration + contract tests + fixtures
│  └─ console/      web UI
├─ db/              migrations, RLS policies, seeds (synthetic only)
├─ fixtures/        synthetic cases exported from the workbook (golden files)
└─ ops/             infra-as-code, CI, runbooks, pen-test evidence
```

**Rules for every change**
1. `engine/` stays pure and is tested against the workbook's golden files before any UI uses it.
2. No real PII in the repo, fixtures, logs or prompts.
3. Every PR updates tests and, where behaviour changes, the relevant ADR or the workbook.
4. Definition of done: tests pass · audit log entries present · evidence tag enforced · reason codes present · no decision path without a human · docs updated.
5. Use Claude for architecture, specs, test design and review; use the implementation agent for scaffolding against those specs; review every diff that touches `engine/`, `rules/`, consent messaging or the ledger yourself.
