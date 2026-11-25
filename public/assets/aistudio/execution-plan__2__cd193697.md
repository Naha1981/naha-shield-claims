# NahaShield — Execution Plan (`execution-plan.md`)

| | |
|---|---|
| **Companion to** | `plan.md` (what and how) · `NahaShield_ROI_Evidence_Model_v1.0.xlsx` (spec, KPIs, dated roadmap) |
| **Planning date** | Wednesday 25 November 2026 |
| **Programme start (Week 1)** | Monday 30 November 2026 — change it in `Inputs` and the workbook's dates move |
| **Operating model** | One builder (NahaLabs), AI-assisted implementation, one design-partner insurer at a time |

---

## 0. Planning basis (read this first)

1. **Capacity:** sized for roughly 30–40 focused hours a week. If the real number is lower, use the **cut line in §10** — do not stretch every deliverable.
2. **The build is not the constraint.** Counsel, sponsor access, lawful basis and data are the long-lead items. They start in Week 1 and run in parallel with code.
3. **South African calendar risk.** Corporate sponsors typically go quiet from mid-December to early/mid-January. Public holidays in the window (confirm against the official calendar): 16 Dec, 25 Dec, 1 Jan, 22 Mar (observed), 26 Mar (Good Friday), 29 Mar (Family Day). Phase 0 is therefore **6 weeks, not the PRD's 4**: four weeks of build, then a two-week buffer for the sponsor readout.
4. **No ROI promises.** Phase 0 baselines the insurer's own numbers; the signed ledger is the only proof.
5. **Seasonality target:** the claims peak runs August–January. Phase 2 must be at least in shadow mode and scale-tested **before 2 August 2027** so the peak season becomes the proof season.

---

## 1. Calendar at a glance

| Phase | Weeks | Dates | Goal | Gate |
|---|---|---|---|---|
| **0** Synthetic & historical proof | 1–6 | 30 Nov 2026 – 8 Jan 2027 | Prove value on de-identified data; sponsor signs Pilot Scope | **G0** |
| **1A** Recovery desk (M1 + C1) | 7–19 | 11 Jan – 9 Apr 2027 | Live in the sponsor's recovery team; first co-signed ledger | **G1A** |
| **1B** Consent & cover integrity (M2) | 11–23 | 8 Feb – 7 May 2027 | Consent certificates in test, then in onboarding | **G1B** |
| **2** Claims & channel integrity (M3) | 20–45 | 12 Apr – 8 Oct 2027 | Shadow → live before and through the August peak | **G2** |
| **3** Consortium (M4) | 46+ | from 11 Oct 2027 | Gated on POPIA s57/58 authorisation | **G3** |

---

## 2. Workstreams

| WS | Name | Owner | What it covers |
|---|---|---|---|
| WS1 | Product & engineering | Founder (+ AI agents) | Engine, API, console, tests, releases |
| WS2 | Legal & compliance | Counsel + sponsor DPO | POPIA, PPR, FIC, recovery routes, message templates, operator agreement |
| WS3 | Design partner & commercial | Founder | Sponsor access, discovery, pilot scope, pricing validation, contracts |
| WS4 | Data & integrations | Founder + sponsor IT | Batch exports, bureau/Deeds/CIPC access, adapters, WhatsApp onboarding |
| WS5 | Security & operations | Founder (+ external tester) | Infra, residency, secrets, monitoring, pen test, runbooks |

---

## 3. First ten working days (do these in order)

### Week 0 — Thu 26 – Fri 27 Nov
| # | Action | Done when |
|---|---|---|
| 1 | Send the sponsor contact a short recap and ask for the Phase 0 inputs: **D-01, D-02, D-03, D-06** from the `Discovery` sheet | Email sent; date for discovery meeting set |
| 2 | Shortlist 2–3 SA data-protection / insurance-regulatory firms; send the counsel brief (§8) | Quotes requested |
| 3 | Decide hosting region and compute location (**plan.md D3**) | ADR-001 written |
| 4 | Create repo skeleton per `plan.md` §12; commit `docs/` and the workbook | Repo live |

### Week 1 — Mon 30 Nov – Fri 4 Dec  *(Sprint S0 starts)*
| # | Action | Done when |
|---|---|---|
| 5 | Engage counsel; raise **cross-border operator question (plan.md D4)** first | Engagement letter or written scope |
| 6 | Run the sponsor discovery meeting using the `Discovery` sheet | D-01…D-05 answers captured |
| 7 | Export synthetic data from the workbook as golden fixtures | `fixtures/` committed |
| 8 | Stand up CI, lint, test runner and the empty `engine/` package | Green pipeline |
| 9 | Draft the Phase 0 readout template ("R lost / R collectable / R wasted") | Template reviewed |

### Week 2 — Mon 7 – Fri 11 Dec  *(S0 ends Fri 11 Dec)*
| # | Action | Done when |
|---|---|---|
| 10 | Database schema v0 + append-only evidence vault with hash chain and tamper test | Tamper test fails closed |

---

## 4. Sprint plan

Two-week sprints. Detail is deliberate for S0–S3 and goal-level after that; refine each sprint at its planning session.

### S0 — Foundations · Weeks 1–2 · 30 Nov – 11 Dec
**Goal:** a verifiable base and the long-lead items started.

| Deliverable | Acceptance criteria |
|---|---|
| Repo, CI, ADR log, infra decision | Pipeline green; ADR-001 (region/compute) and ADR-002 (single-tenant per insurer) recorded |
| Schema v0 | Migrations apply cleanly; evidence tag is `NOT NULL`; no table allows a decision without `reviewer_id` |
| Evidence vault | Insert-only; hash chain verifies; tamper test fails closed; chain-of-custody log written |
| Synthetic data generator | Generates 25 recovery cases, 30 consent policies and ledger rows that match the workbook shapes |
| Long-lead tasks started | Counsel engaged; sponsor discovery held; data-access applications listed |

### S1 — NRV and route engine · Weeks 3–4 · 14 – 25 Dec *(holiday-light)*
**Goal:** the heart of M1 as a tested library plus CLI.

| Deliverable | Acceptance criteria |
|---|---|
| `engine`: NRV, 8 value layers, flags, early write-off, route order, s300 forum + warning, state-referral pack | **Identical outputs to `Recovery_Triage` for all 24 synthetic cases** |
| `engine`: ledger counting rules | Reproduces the 13 `Ledger` example rows including "not money" and "awaiting sign-off" cases |
| `engine`: consent tiering + independence status | Reproduces the 30 `Consent_Audit` rows |
| Report generator | Produces the Phase 0 readout from a CSV in under a minute |
| CLI | `nahashield triage cases.csv` and `nahashield consent-audit policies.csv` run end to end |

*Note: 16 and 25 Dec are public holidays; plan on fewer working days.*

### S2 — Phase 0 pack and buffer · Weeks 5–6 · 28 Dec – 8 Jan *(low intensity)*
**Goal:** a finished readout ready for the first sponsor slot in January.

| Deliverable | Acceptance criteria |
|---|---|
| Phase 0 pack | Readout, methodology note, assumptions list, limitations, next-step proposal |
| Sponsor readout (target week of 4 Jan) | Sponsor confirms workflow fit and missing consent/recovery controls |
| Pilot Scope draft | KPIs and kill criteria copied from the `Pilot` sheet, with owners |
| Console skeleton | Login, role shell, case list (no business logic yet) |

### S3 — Phase 1A start · Weeks 7–8 · 11 – 22 Jan
**Goal:** a sponsor-ready tenant and the first real data path.

| Deliverable | Acceptance criteria |
|---|---|
| Pilot Scope signed (**MS-05**) | Signed scope, KPIs, kill criteria |
| Single-tenant environment in the agreed SA region | Residency evidence collected; encryption and secrets verified |
| Auth, SSO/RBAC, audit log | Role tests pass; every read of sensitive data is logged |
| Loss-register import | Sponsor's de-identified historical cases load and reconcile to source totals |
| Operator agreement + lawful-basis register in progress | Drafts with counsel/DPO |

### S4 — Triage desk · Weeks 9–10 · 25 Jan – 5 Feb
Triage UI (8-layer profile, NRV range vs execution cost), batch adapters for Deeds/CIPC/bureau exports, case management with owners and deadlines. **Done when:** a recovery specialist can take one case from register → triage → route recommendation without leaving the console.

### S5 — Legal route card and M2 groundwork · Weeks 11–12 · 8 – 19 Feb
Route card with counsel gate and s300(5)(b) warning; deadline engine (prescription, s300 windows); consent service skeleton; **submit WhatsApp message templates for approval**; counsel review of consent and duress wording. **Done when:** every route recommendation requires a named human decision and logs reason codes.

### S6 — Ledger and executive view · Weeks 13–14 · 22 Feb – 5 Mar
Ledger service, dual sign-off UI, bank-reconciliation import, executive reconciliation dashboard (separates confirmed loss, judgment value, agreed plan, costs, outstanding principal, bank-reconciled cash). **Done when:** the monthly ledger exports with both signatures and cannot show a stronger label than its data supports.

### S7 — Go live in the recovery team · Weeks 15–16 · 8 – 19 Mar
M1 live with named sponsor users (**MS-08**, week 15); consent flow v1 on WhatsApp in test. **Done when:** at least one live case has been triaged and one ledger entry captured.

### S8 — Consent end to end · Weeks 17–18 · 22 Mar – 2 Apr *(22, 26 and 29 Mar are holidays)*
Consent certificate, comprehension check, silent duress, policy-event alerts, own-book stacking (**MS-09**, week 17); first monthly ledger co-signed (**MS-10**, week 18). **Done when:** duress screen is indistinguishable from an ordinary error in testing and the first ledger carries both signatures.

### S9 — Gate G1A and M3 design · Weeks 19–20 · 5 – 16 Apr
Run the `Pilot` sheet; hold the Phase 1A go/no-go (**MS-11**, week 19). M2 onboarding/policy-change webhook; M3 data model and timer design.

### Phase 2 blocks (weeks 20–45)

| Block | Weeks | Dates | Deliverables |
|---|---|---|---|
| **P2-a** | 20–27 | 12 Apr – 4 Jun | Claims model; **2+14 business-day timer service**; Astute / WinDeed adapters; triangulation scorecard in **shadow mode** (**MS-12**, week 26) |
| **P2-b** | 28–35 | 7 Jun – 30 Jul | AVS-R pre-EFT gate; forged-template hash library; Basdeo-compliant notice templates; lawful living-person contact; **scale test (300k claims/yr at 3×) and penetration test finish by 30 Jul** |
| **P2-c** | 36–45 | 2 Aug – 8 Oct | Peak-season operation; AgentShield; supervised-ML evaluation only if enough confirmed labels exist; fairness and drift dashboards; **Gate G2** |

### Phase 3 (week 46+) — gated, not scheduled as build
Engage ASISA's Information Sharing Working Group from Q2 2027; support insurers' POPIA s57/58 application (they are the responsible parties); PSI design spikes only. **No production cross-insurer matching until written authorisation and Competition Act / ASISA governance sign-off are on file.**

---

## 5. Gate checklists

### G0 — Phase 0 exit (week 6)
- [ ] 20–50 de-identified or synthetic cases reconciled in `Recovery_Triage`
- [ ] Readout delivered: R lost / R realistically collectable / R wasted
- [ ] Historical consent-gap audit delivered (share with independent consent on record)
- [ ] Sponsor named, executive owner confirmed (kill criterion K-01 clear)
- [ ] Lawful POPIA authority path identified (K-02 clear)
- [ ] Handoff gaps vs XTND / Astute / ICB / internal SIU documented (K-03 clear)
- [ ] **Pilot Scope signed**

### G1A — Phase 1A exit (week 19)
- [ ] 100% of pilot recovery portfolio reconciled with NRV and tenure classification (`P-01`)
- [ ] Reduction in projected legal spend on non-executable cases ≥30% vs the sponsor baseline (`P-02`)
- [ ] Zero missed statutory deadlines (`P-03`)
- [ ] Ledger co-signed by Forensics and Finance every pilot month (`P-04`)
- [ ] Financial hurdle `P-12` = PASS (net ledger benefit exceeds platform fees)
- [ ] `Pilot` overall status = **GO**

### G1B — Phase 1B exit (week 23)
- [ ] ≥90% independent consent reachability on valid third-party test cohort (`P-05`)
- [ ] Zero unlawful auto-declines (`P-06`); incremental false positives ≤1.0% (`P-07`)
- [ ] Counsel sign-off on consent wording, duress flow and message templates
- [ ] Zero NFO adverse findings (`P-11`)

### G2 — Phase 2 exit (week 45)
- [ ] Incremental catch of paid-before-discovery fraud ≥20% at ≤1.0% false positives (`P-08`)
- [ ] ≥90% of intake checks scored within 4 hours (`P-09`); zero platform-caused PPR 2A.8 breaches (`P-10`)
- [ ] Penetration test and scale test reports on file
- [ ] Fairness review completed; no prohibited features in any model

### G3 — Phase 3 entry
- [ ] Information Regulator prior authorisation (POPIA s57/58) or approved industry code of conduct
- [ ] Competition Act / ASISA governance sign-off
- [ ] At least two insurers running NahaShield internally

---

## 6. Design-partner and commercial execution

**Target:** mid-sized or large funeral-heavy life/funeral insurers with a visible recovery backlog. Start with one; do not run parallel pilots.

| Step | Output | Owner on the insurer side |
|---|---|---|
| 1. Discovery | `Discovery` sheet D-01…D-12 answered | Forensics, Recoveries, Underwriting |
| 2. Phase 0 proposal | One-page scope: data needed, deliverables, no PII, no integration | Head of Forensics |
| 3. Phase 0 readout | "R lost / R collectable / R wasted" + consent-gap findings | Forensics + Finance |
| 4. Pilot Scope | KPIs, kill criteria, ledger co-signers, success-share terms | CRO + CFO |
| 5. Contracting | Operator agreement, DPA, IP, success-share legal review, SLAs | Legal + DPO |

**Messaging rules (from the ROI brief):**
- "We don't guess your ROI upfront — Phase 0 baselines your own recovery rate, wasted legal spend and missing consent records."
- "Arrests, convictions and judgments are not money; our ledger counts cleared bank cash, net of costs."
- "We integrate alongside XTND, ICB and Astute; if they catch it first, they get the credit."
- "Our AI never denies a claim — every flag goes to a named human with evidence and statutory timers."

**Pricing validation (do not finalise before case-volume discovery):**
1. Replace the `Inputs` placeholders with sponsor data; read the `ROI` module P&L.
2. The placeholder model shows **M1 carries the Rand case; M2 and M3 are negative on direct Rands at the Base scenario**. Position M2 as NFO/consent compliance and M3 as per-claim risk protection, and test whether per-claim fees plus verification pass-through are acceptable.
3. Use `Sensitivity` Grid 3 to show break-even volume by insurer size.

---

## 7. Compliance and legal execution

| When | Action |
|---|---|
| Week 1 | Counsel engaged; cross-border operator position (plan.md D4) |
| Weeks 2–6 | Lawful basis per data source; s71 position; Phase 0 de-identification standard |
| By week 9 | Operator agreement and lawful-basis register signed (MS-06) |
| By week 12 | Counsel-approved consent wording, duress flow, neutral notices |
| Before M3 live | Basdeo-compliant deferment template; FIC s29/s53 tipping-off review; parlour (2A.10) flow |
| Quarterly | Fairness and disparity review by geography and product |
| Phase 3 | POPIA s57/58 application support; Competition Act / ASISA governance |

---

## 8. Counsel brief (questions to send in Week 1)

1. If NahaLabs (Pty) Ltd is a Lesotho entity, what POPIA transborder rules apply when an SA insurer sends personal information to it as operator? Do we need an SA-registered operator entity or in-environment access only?
2. Lawful basis and special-personal-information treatment for a de-identified historical cohort pilot.
3. Confirm POPIA s71 interpretation: what "named human reviewer + documented objective reasons" must contain.
4. Silent-duress consent flow and neutral messaging: any tipping-off risk under FIC s29(4)/s53?
5. CPA s300 / s297 / s300(5)(b) sequencing; Masindi wording review for short-term vs long-term contracts; Rule 46A timelines.
6. Success-share fee structure on recoveries: any fee-sharing restriction?
7. PPR 2A.8.2 Basdeo-compliant deferment notices; PPR 2A.10 voluntary parlour election.
8. Path to POPIA s57/58 authorisation or an industry code of conduct for Phase 3.

---

## 9. Operating cadence and metrics

**Weekly (Friday, 45 minutes):** review the table below, update `Pilot`/`Discovery`, decide the next week's top three.

| Metric | Target |
|---|---|
| Sponsor touchpoints held | ≥1 per week |
| Discovery questions answered (of 12) | 5 by week 2; 12 by week 8 |
| Compliance register items moved to Done | Rising every sprint |
| Golden-file tests passing | 100% |
| Open decisions waiting on counsel/sponsor | Falling; none older than 2 weeks |
| Planned vs actual sprint scope | ≥80% delivered |

**Per sprint:** planning (1 h), demo to the sponsor where possible, retro (30 min), update this file's dates.

---

## 10. Capacity and cut line

If time runs short, cut in this order. **Never cut** the items in the second table.

| Cut first → last | Item |
|---|---|
| 1 | USSD / IVR delivery (keep WhatsApp + callback) |
| 2 | AgentShield (remuneration integrity) |
| 3 | Forged-template hash library |
| 4 | Supervised ML v2 (stay on rules + graph) |
| 5 | Voluntary parlour verification flow |
| 6 | Executive dashboard polish |

| Never cut | Why |
|---|---|
| Append-only evidence vault and evidence tags | Admissibility and trust |
| Human-in-the-loop on every adverse step | POPIA s71, PPR |
| Ledger counting rules and dual sign-off | The product's credibility |
| Timer accuracy tests | Statutory exposure |
| Tipping-off lint and duress-flow testing | Safety |

---

## 11. Risks, assumptions and dependencies (RAID — top items)

| # | Type | Item | Trigger | Response |
|---|---|---|---|---|
| R1 | Risk | Sponsor unavailable over year-end | No meeting booked by 4 Dec | Demo from synthetic data; target first week of January |
| R2 | Risk | Cross-border operator issue | Counsel flags s72 problem | SA entity or in-environment access; escalate before contract |
| R3 | Risk | Cloudflare/compute residency not satisfiable | ADR-001 finding | Move compute and timers to SA region |
| R4 | Risk | Existing tools cover the workflow | D-04 shows no gap | Stop (K-03) or re-scope to M2 only |
| R5 | Risk | WhatsApp template rejection | Meta/provider feedback | Rewrite templates; callback fallback |
| R6 | Risk | False positives harm families | FP rate >1.0% | Tighten tiering; widen human review; pause rule |
| R7 | Risk | Solo-builder overload | Two consecutive sprints <80% | Apply cut line; defer Phase 2 scope |
| A1 | Assumption | Sponsor provides batch exports | — | Phase 0 works on synthetic data regardless |
| A2 | Assumption | Placeholder economics are directionally right | Sponsor data differs | Re-run `ROI`; change positioning, not claims |
| D1 | Dependency | Counsel availability | No response in 10 days | Second firm |
| D2 | Dependency | Insurer-sponsored credentials for bureau/Deeds | Access delayed | Manual trace upload |

---

## 12. Definition of done

**Per feature:** tests pass (including workbook golden files) · evidence tag enforced · reason codes present · audit log entry · no decision path without a named human · docs/ADR updated.

**Per release:** security scan clean · tamper and tenant-isolation tests pass · tipping-off lint clean · timer tests pass · release notes list known limitations in plain language.

**Per sponsor deliverable:** language rules applied (*exposure* / *would have protected* / *protected / recovered*) · assumptions listed · no claim stronger than the ledger supports.

---

## 13. AI-assisted build operating model

| Task | Who / what |
|---|---|
| Architecture, specs, test design, compliance mapping, review of risky diffs | Claude |
| Scaffolding, CRUD, UI, adapters against a written spec | Implementation agent (Claude Code or equivalent) |
| `engine/`, `rules/`, consent messaging, ledger code | Written against golden files; **reviewed line by line by you** |
| Anything touching real data | You only; never paste PII into prompts |

**Prompt pack per sprint (keep each prompt to one outcome):**
1. *Spec prompt:* paste the relevant workbook sheet and the `plan.md` section; ask for types, function signatures and test cases only.
2. *Build prompt:* implement against the failing tests; no new behaviour outside the spec.
3. *Review prompt:* "List every path that could create a decision, a stronger ledger label, or a message to a claimant without a human or without a tipping-off check."
4. *Red-team prompt:* "Try to make this flow reveal suspicion to a coercer, or count an unsigned rand."

---

## 14. Immediate decisions needed from you

1. Hosting region and where PII-touching compute runs (ADR-001).
2. Confirmation of the NahaLabs entity position for cross-border purposes (counsel question 1).
3. Whether to accept the 6-week Phase 0 (recommended) or hold the PRD's 4 weeks and accept sponsor-access risk.
4. The booking factor to propose to sponsors' CFOs for cancelled unauthorised policies (workbook placeholder: 10%).
5. Which insurer is the first design partner, and who will co-sign the ledger.
