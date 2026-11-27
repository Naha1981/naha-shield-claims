# NahaShield Claims-Agents: SIM, RICA and SIM-swap indicator module

Status: Phase 1 built and tested on SYNTHETIC data only. Nothing is released to production. No real telco, RICA or DHA data was used. Everything outside Phase 1 below is design, not working software.

Code: `src/lib/engine/simRica.ts`, tests `src/lib/engine/simRica.test.ts` (7 tests). Schemas and sample brief are in this folder.

Principle: these are indicators that prompt a human to look. A SIM swap or RICA mismatch is never proof of fraud. The module never rejects a claim, never releases a payout, never sends a message to a claimant. The strongest output is a payout-hold recommendation that a named human must sign off (POPIA s71: no decision based solely on automated processing).

## Part 1. Software and deterministic architecture

### 1.1 Signals and where they come from

| Signal | Source | Status today |
|---|---|---|
| Same number on several parties/policies (clustering) | Internal policy, claim, beneficiary, provider records | Built, deterministic |
| Contact-number change velocity per policy | Internal edit log timestamps | Built, deterministic |
| Beneficiary / bank-detail / payout-instruction / claim-lodged timestamps | Internal change log | Built (input to the swap rule) |
| Declared relationships between parties (softens clusters) | Internal records | Built |
| SIM-swap timestamp, IMEI/IMSI change, number tenure | Licensed telco / aggregator SIM-swap API | `needs-setup`; simulated connector only |
| RICA registration status and registered-ID match | Licensed RICA/KYC data provider | `needs-setup`; simulated connector only |
| SA ID validity and life status | DHA / licensed verification provider | `needs-setup`; only a Luhn format check exists locally |
| WhatsApp/session metadata, IP/geolocation mismatch | Channel provider logs, own web logs | `needs-setup`; not built. Only usable if consent and lawful basis exist |
| Liveness / biometric re-verification | Open-source liveness tooling plus human review | Phase 2 design only |

Connector interface (`TelcoConnector`): `mode` (`SIMULATED` | `NEEDS_SETUP` | `LIVE`), `simSwapCheck(msisdn, now)`, `ricaMatchCheck(msisdn, claimedSaId, now)`. Shipped: `SimulatedTelcoConnector` (fixtures; output labelled INFERRED and `mode: SIMULATED`, never VERIFIED) and `NeedsSetupConnector` (always UNKNOWN, note `needs-setup`). There is no LIVE implementation in this patch. A LIVE connector may only produce VERIFIED when it returns a real provider record.

Evidence labels: VERIFIED (internal record, or live provider record), INFERRED (derived, or any simulated data), UNKNOWN (not established; a missing connector is UNKNOWN, never "clean").

### 1.2 Rules and thresholds (hard-coded, in `simRica.ts`)

- Shared number: 2 parties = REVIEW (weight 2), 3 or more = ELEVATED (weight 3); declared family relationship lowers it (weight 1 and an innocent-explanation signal); overlap with funeral parlour / doctor / call-centre agent / broker adds weight 3.
- Number-change velocity: 2 or more contact-number changes in 30 days, or 3 or more in 90 (weight 2, weight 3 at 3 in 30 days).
- SIM swap before a sensitive change (beneficiary, bank details, payout instruction, claim lodged): STRONG within 7 days (weight 4), MODERATE within 14 (weight 2), WEAK within 30 (weight 1). A change before the swap does not count. Unknown or unavailable swap data never triggers anything.
- RICA: not registered (3), registered to a different ID than the policyholder/insured/beneficiary (2), unknown (0, shown as UNKNOWN).
- Triage band from the summed weights: 4 or more ELEVATED, 2 or 3 REVIEW, else NO_INDICATORS. The band is a prompt to look.
- Payout-hold recommendation: only a STRONG swap-before-change, and in this pilot only from SIMULATED or LIVE-VERIFIED swap data. Output always carries `requires_human_signoff: true`, `auto_reject: false`, `proof_of_fraud: false`.
- Thresholds are starting values for pilot calibration against synthetic data. They are not validated against real fraud outcomes.

### 1.3 State machine and step-up flow

States: CLEAR, REVIEW_RECOMMENDED, PAYOUT_HOLD_PENDING_SIGNOFF, PAYOUT_HELD, STEP_UP_REQUESTED, STEP_UP_PASSED, STEP_UP_FAILED_ESCALATED, HUMAN_DECISION_RECORDED. There is no state for auto-reject or auto-release. Sign-off, clearing and decisions need a named human in an authorised role (agents, "system" and scheduler ids are refused). Illegal transitions throw.

Step-up when a swap is flagged (steps for the human; the module sends nothing):
1. Never send an OTP or message to the swapped number.
2. Contact the customer through a number or channel held on file before the swap, or in branch.
3. Ask for ID re-verification or a liveness check (Phase 2, open-source tooling plus human review).
4. A neutral, non-accusatory request goes out only as an approval card a human sends.
5. A human records the decision (release, continue hold, refer to SIU, no further action).

### 1.4 Data model and audit (design; only the audit chain is built)

Tables (Postgres, matching `db/migrations`): `phone_numbers(msisdn_ref pk, msisdn_enc, first_seen_at)`; `phone_links(link_id, msisdn_ref, party_ref, party_role, policy_ref, claim_ref, first_seen_at, source)`; `sim_events(event_id, msisdn_ref, kind, occurred_at, connector_mode, label, raw_response_enc)`; `rica_checks(check_id, msisdn_ref, id_hash, registration, id_match, connector_mode, label, checked_at)`; `change_events(event_id, policy_ref, claim_ref, kind, at, actor_ref)`; `sim_assessments(claim_ref, as_of, triage_band, hold_recommended, state, signals_json)`; `sim_decisions(claim_ref, actor, role, decision, reason, at)`.

Audit: every assessment, hold sign-off, step-up and decision is appended to a hash chain (`appendSimAudit`, `verifySimAudit`, tested for redaction and tamper detection). The existing Evidence Vault chain is the intended home. immudb is a free open-source option for Phase 2 anchoring; it is not installed or tested here.

POPIA redaction: MSISDNs are shown as `+27*****1234`, SA IDs as `*********1234`; `redactText` scrubs both from free text and is applied to briefs and audit data. Clustering and agents use a salted `msisdn_ref` (`MS-` plus 10 hex) and a salted ID hash. Store raw values encrypted, outside agent context. Microsoft Presidio (open source) with custom SA ID and MSISDN recognisers is the Phase 2 option for unstructured documents; the regex redaction here is the tested Phase 1 baseline and will miss unusual formats. Calling a telco or RICA provider needs a recorded lawful basis or consent reference (`consent_ref` in the tool schemas).

## Part 2. AI agent design

### 2.1 Agent responsibilities
All agents call deterministic tools and write the result; they do not compute risk themselves.
- Entity/Geo: runs `sim_swap_check` and `rica_match_check`, reports label and connector mode for each, lists UNKNOWN items.
- Network/Syndicate: runs clustering and velocity across claimants, beneficiaries, funeral parlours, doctors, call-centre agents and binders; reports shared numbers with relationship context.
- Document Forensics: compares ID and bank details on documents with the RICA registered-ID result and policy record; flags conflicts only.
- SLA/Concierge: drafts neutral requests for step-up confirmation as approval cards; never sends them.
- Compliance/Vault: records the audit chain, checks POPIA consent reference and s71 sign-off, assembles board/compliance reports (Phase 3).

Prompt rules for every agent (system prompt text):
> You work with indicators, not conclusions. Label each statement VERIFIED, INFERRED or UNKNOWN and say whether the telco/RICA connector is LIVE, SIMULATED or needs-setup. For every fraud indicator list the plausible innocent explanations (lost or stolen phone, family member's phone, handset upgrade, relative registered the SIM, provider data lag). Never call a SIM swap or RICA mismatch proof of fraud. Never write accusatory text. Never reject a claim or release a payout; recommend and wait for a named human. Show MSISDNs and SA IDs only in redacted form.

### 2.2 Example commands
1. "Check claim SYN-0412 for a SIM swap before the bank-detail change and tell me what is verified and what is unknown."
2. "Does the RICA registration for the beneficiary's number match the beneficiary's ID on file? Say if the connector is live."
3. "Show every policy that shares a phone number with this claimant, including funeral parlours and brokers."
4. "List numbers that changed contact details more than twice in 30 days this month."
5. "Which flagged claims have a payout hold recommended and still need sign-off?"
6. "Draft a neutral request asking the policyholder to confirm a recent change on a number we held before the swap. Hold it for my approval."
7. "Build an investigator brief for SYN-0412 with innocent explanations."
8. "Map numbers shared between call-centre agent IDs and claimants this quarter."
9. "Compliance: show the audit trail for the hold on SYN-0412 and who signed it off."
10. "Summarise SIM/RICA indicator volumes and outcomes for the monthly compliance report."

Commands 1 to 3, 5 and 7 map to built deterministic functions; 4 is `numberChangeVelocity`; 6, 8, 9 and 10 need Phase 2/3 wiring. No command is wired into the live agents yet.

### 2.3 Syndicate and churn detection
`clusterPhones` groups by normalised number and reports parties, policies and roles. Shared numbers between claimant-side parties and service providers are weighted higher; declared relatives lower. Churn (reuse of a number after reassignment) can only be told apart from fraud with telco number-tenure data, which is `needs-setup`.

### 2.4 Guardrails (enforced in code and tests)
VERIFIED vs INFERRED vs UNKNOWN labels; connector mode printed in every brief; innocent explanations attached to each signal; `auto_reject: false`, `proof_of_fraud: false`, human sign-off flag; state machine with no auto-decision; brief language tested to exclude accusatory words (a keyword check, not a guarantee for free-text agent output).

## Part 3. Phased plan

Phase 1 (done on synthetic branch): clustering, velocity, swap-vs-change rule, simulated connector, state machine, redaction, audit chain, brief, tests. Next in Phase 1: wire read-only into the synthetic claim view and approval cards; add synthetic fixtures for the acceptance script.
Phase 2: licensed SIM-swap and RICA connectors (needs a provider contract, POPIA lawful basis and Information Officer sign-off; cost unknown, not free); DB tables; Vault/immudb anchoring; Presidio for documents; liveness step-up with open-source tooling plus human review; calibrate thresholds on real outcomes.
Phase 3: automated board/compliance reporting from the audit chain and decisions.

Sample schemas: `sim_swap_check.schema.json`, `rica_match_check.schema.json`. Sample brief: `sample-investigator-brief.txt`.

## Limits
Simulated data only; thresholds unvalidated; regex redaction baseline; no live connector, no DB migration, no UI wiring, no agent prompt wiring in this patch.
