Below are two realistic, fully worked demo cases for the **“See worked-out case example”** page. They are aligned to Pride Life-style funeral-cover operations and the claims environments Lawrence experienced at Discovery and Liberty: high-volume funeral claims, agent distribution, quick payouts, duplicate-cover risk, and fraud syndicates.

All figures are fictional demo data, but the economics are calibrated to realistic South African funeral-insurance patterns. ASISA reported 2,282 fraudulent or dishonest funeral claims worth R80.8 million in 2020, and funeral policies represented 71% of all reported fraud cases that year. [asisa.org](https://www.asisa.org.za/media-releases/archived-media-releases/life-insurers-report-significant-increases-in-funeral-insurance-fraud-for-2020/)

## Demo case 1: No fraud

### Case summary

| Field | Value |
|---|---|
| Claim reference | `CLM-2026-00421` |
| Insurer | Pride Life SA |
| Product | Funeral cover |
| Claim amount | R25,000 |
| Policyholder | Mrs Nomsa Dlamini |
| Deceased | Mr Sipho Dlamini |
| Claimant | Mrs Nomsa Dlamini |
| Relationship | Spouse |
| Agent | Agent 118 |
| Date of death | 12 May 2026 |
| Claim submitted | 14 May 2026 |
| Decision date | 15 May 2026 |
| Final outcome | Approved and paid |
| NahaShield outcome | **Cleared — no fraud** |

### What Lawrence sees

When Lawrence opens the case, he sees:

```text
CLAIM STATUS: APPROVED AND PAID
AMOUNT CLAIMED: R25,000
AMOUNT PAID: R25,000
FRAUD RISK: LOW
DUPLICATE RISK: LOW
EVIDENCE STRENGTH: STRONG
REGULATORY CLOCK: DECIDED WITHIN 2 BUSINESS DAYS
CLAIMANT EXPERIENCE: GOOD
REVENUE PROTECTED: R0
REVENUE SAVED: R0
REVENUE RECOVERED: R0
```

### Why this matters

This is the case that proves NahaShield is not a blunt fraud tool. It shows that the system can identify a legitimate claim quickly, release it for payment, and avoid harming a grieving family.

This is essential for Lawrence because insurers cannot tolerate a system that delays valid claims or creates complaint risk.

## Case 1 flow

### Step 1: Claim received

The claim is submitted through an agent app.

```text
Agent 118 submits claim CLM-2026-00421.

Policyholder: Mrs Nomsa Dlamini
Deceased: Mr Sipho Dlamini
Claimant: Mrs Nomsa Dlamini
Relationship: Spouse
Cover amount: R25,000
Date of death: 12 May 2026
Claim submitted: 14 May 2026
```

### Step 2: NahaShield runs checks

```text
1. Policy check
2. Identity check
3. Death-registration check
4. Beneficiary check
5. Duplicate-cover check
6. Duplicate-claim check
7. Document check
8. Payment-history check
9. Agent-risk check
10. Claims-clock check
```

### Step 3: Check results

| Check | Result | Evidence |
|---|---|---|
| Policy active | Passed | Policy active since 2023 |
| Premiums paid | Passed | No arrears |
| Identity verified | Passed | Claimant identity matches policyholder |
| Death verified | Passed | Death registered on 12 May 2026 |
| Beneficiary verified | Passed | Claimant is recorded spouse |
| Duplicate policy | None found | No other policy on same deceased |
| Duplicate claim | None found | No other claim on same deceased |
| Document check | Passed | Death certificate and ID consistent |
| Agent risk | Low | Agent 118 has clean 24-month record |
| Claims clock | Passed | Decision within two business days |

### Step 4: NahaShield recommendation

```text
RECOMMENDATION: APPROVE FOR PAYMENT

REASON:
All required verification checks passed.
No duplicate cover detected.
No suspicious timing.
No agent-risk signal.
Claimant is verified spouse and authorised beneficiary.

NEXT STEP:
Release claim for payment.

HUMAN APPROVAL:
Claims assessor: Thabo M.
Approved: 15 May 2026, 10:12
```

### Step 5: Payment and closure

```text
Payment instruction issued: 15 May 2026
Payment method: EFT
Amount paid: R25,000
Payment status: Paid
Claim status: Closed — paid
Claimant notified: Yes
```

### Case 1 deliverables

| Deliverable | Value |
|---|---|
| Claim decision | Approved |
| Claim amount | R25,000 |
| Time to decision | 1 business day |
| Fraud indicators | 0 |
| Duplicate indicators | 0 |
| Revenue protected | R0 |
| Revenue saved | R0 |
| Revenue recovered | R0 |
| Claimant experience | Positive |
| Compliance outcome | Compliant |
| NahaShield value | Fast, fair claims handling |

### Case 1 lesson for Lawrence

> “NahaShield did not create work. It confirmed a valid claim, protected the customer experience, and allowed the insurer to pay quickly.”

## Demo case 2: Fraud detected

### Case summary

| Field | Value |
|---|---|
| Claim reference | `CLM-2026-00887` |
| Insurer | Pride Life SA |
| Product | Funeral cover |
| Claim amount | R75,000 |
| Policyholder | Mr Sibusiso Mkhize |
| Deceased | Mr Sibusiso Mkhize |
| Claimant | Ms Zanele Mkhize |
| Relationship | Recorded as sister |
| Agent | Agent 204 |
| Date of death | 3 June 2026 |
| Claim submitted | 4 June 2026 |
| NahaShield outcome | **Held, investigated, payment prevented** |
| Revenue protected | R75,000 |
| Revenue saved | R75,000 |
| Revenue recovered | R0 at claim stage |

### What Lawrence sees

```text
CLAIM STATUS: HELD FOR INVESTIGATION
AMOUNT CLAIMED: R75,000
AMOUNT AT RISK: R75,000
FRAUD RISK: HIGH
DUPLICATE RISK: HIGH
EVIDENCE STRENGTH: STRONG
REGULATORY CLOCK: RUNNING
REVENUE PROTECTED: R75,000
REVENUE SAVED: R75,000
REVENUE RECOVERED: R0

REASON:
Multiple high-risk indicators detected.
Payment held before payout.
Human investigator assigned.
```

### Fraud pattern

The case contains a realistic syndicate-style pattern:

- The policy was issued 21 days before the claim.
- Cover was increased from R25,000 to R75,000 ten days before death.
- A SIM swap occurred 36 hours before the bank-account change.
- The payout bank account was changed two days before the claim.
- The same bank account received payouts on three unrelated claims.
- The same funeral parlour appeared on 11 claims in 40 days.
- The same certifying doctor appeared on nine claims in 40 days.
- The claimant was not an immediate family member.
- Consent evidence was incomplete.
- The claim was submitted one day after death.

## Case 2 flow

### Step 1: Claim received

```text
Agent 204 submits claim CLM-2026-00887.

Policyholder: Mr Sibusiso Mkhize
Deceased: Mr Sibusiso Mkhize
Claimant: Ms Zanele Mkhize
Relationship: Sister
Cover amount: R75,000
Date of death: 3 June 2026
Claim submitted: 4 June 2026
Bank account: Newly changed
```

### Step 2: NahaShield runs checks

```text
1. Policy and cover-change check
2. Identity check
3. Death-registration check
4. Beneficiary and consent check
5. Duplicate-cover check
6. Duplicate-claim check
7. Bank-account and payee-change check
8. SIM-swap and telecom check
9. Agent-risk check
10. Provider-risk check
11. Relationship-graph check
12. Claims-clock check
```

### Step 3: NahaShield detects indicators

| Indicator | Result | Risk | Evidence |
|---|---|---:|---|
| Claim submitted one day after death | Flagged | Medium | Claim timeline |
| Policy issued 21 days before claim | Flagged | High | Policy record |
| Cover increased ten days before death | Flagged | High | Cover-change log |
| SIM swap 36 hours before bank change | Flagged | High | Telecom adapter |
| Bank account changed two days before claim | Flagged | High | Payment-change log |
| Same bank account on three unrelated claims | Flagged | High | Payment graph |
| Same funeral parlour on 11 claims in 40 days | Flagged | Medium | Provider graph |
| Same doctor on nine claims in 40 days | Flagged | Medium | Provider graph |
| Claimant not immediate family | Flagged | Medium | Beneficiary record |
| Consent evidence incomplete | Flagged | High | Consent vault |
| Agent has prior duplicate-policy flags | Flagged | Medium | Agent-risk score |

### Step 4: NahaShield risk score

```text
FRAUD RISK SCORE: 92 / 100
DUPLICATE RISK SCORE: 88 / 100
EVIDENCE STRENGTH: 78 / 100

RECOMMENDATION:
HOLD PAYMENT AND ASSIGN TO INVESTIGATION.

REASON:
Multiple independent high-risk indicators detected.
Payment should not be released until verification is complete.

IMPORTANT:
This is an indicator, not a finding of fraud.
A human investigator must review the evidence.
```

### Step 5: Human decision

```text
CLAIMS ASSESSOR:
Hold payment.

REASON:
High-risk indicators detected.
Payment cannot be released until identity, consent,
bank-account ownership, and death verification are complete.

APPROVER:
Claims manager: Naledi K.
Approved: 4 June 2026, 11:20

CLAIMANT NOTIFICATION:
Neutral request sent for:
- Certified ID
- Proof of banking details
- Proof of relationship
- Consent confirmation
- Death documentation
```

### Step 6: Investigation

```text
INVESTIGATOR:
Sipho N.

ACTIONS:
1. Verify death registration.
2. Confirm claimant identity.
3. Verify beneficiary mandate.
4. Confirm bank-account ownership.
5. Contact policyholder’s registered number.
6. Review cover-change history.
7. Review SIM-swap event.
8. Review linked claims.
9. Review funeral parlour and doctor.
10. Prepare evidence pack.
```

### Step 7: Findings

```text
CONFIRMED FINDINGS:
- Bank account linked to three unrelated claims.
- Same funeral parlour linked to 11 claims in 40 days.
- Same doctor linked to nine claims in 40 days.
- Cover increase occurred ten days before death.
- SIM swap occurred 36 hours before bank-account change.
- Consent evidence incomplete.

UNRESOLVED ITEMS:
- Claimant relationship not independently verified.
- Bank-account ownership not confirmed.
- Death registration pending final confirmation.

INNOCENT EXPLANATIONS:
- Family member may have changed banking details.
- SIM swap may have been legitimate.
- Funeral parlour may be high-volume.
- Doctor may serve a large community.

NEXT STEP:
Do not pay.
Escalate to senior investigator.
Refer to compliance and legal if confirmed.
```

### Step 8: Final outcome

```text
FINAL DECISION:
Claim declined.

REASON:
Material misrepresentation and invalid consent evidence.
Payment prevented before payout.

HUMAN APPROVER:
Senior claims manager: Naledi K.
Approved: 9 June 2026

REVENUE PROTECTED: R75,000
REVENUE SAVED: R75,000
REVENUE RECOVERED: R0

RECOVERY STATUS:
Recovery case opened.
Net realisable value assessed.
```

### Case 2 deliverables

| Deliverable | Value |
|---|---|
| Claim decision | Declined |
| Claim amount | R75,000 |
| Revenue protected | R75,000 |
| Revenue saved | R75,000 |
| Revenue recovered | R0 at claim stage |
| Fraud indicators | 11 |
| Duplicate indicators | 4 |
| Evidence items | 18 |
| Human approvals | 3 |
| Time to hold | Same day |
| Time to decision | 5 business days |
| Claimant experience | Neutral, fair, appealable |
| Compliance outcome | Compliant |
| NahaShield value | Revenue protected before payout |

### Case 2 lesson for Lawrence

> “NahaShield did not accuse anyone. It surfaced a pattern, protected R75,000 before payment, and gave the investigator a clear, evidence-based workflow.”

## User journey: past six months

### Step 1: Lawrence logs in

Lawrence opens NahaShield and sees the **Executive Value Board**.

```text
PAST 6 MONTHS — PRIDE LIFE SA

CLAIMS REVIEWED: 12,480
CLAIMS PAID: 11,730
CLAIMS CLEARED: 11,410
CLAIMS FLAGGED: 320
CLAIMS HELD: 180
CLAIMS DECLINED: 95
CLAIMS RECOVERED: 45

REVENUE PROTECTED: R4,860,000
REVENUE SAVED: R3,420,000
REVENUE FOUND: R1,180,000
REVENUE RECOVERED: R610,000

FLAGGED BUT UNCONFIRMED: R1,440,000
CLEARED AS LEGITIMATE: R2,860,000
```

### Step 2: Lawrence opens “Revenue Protected”

```text
REVENUE PROTECTED: R4,860,000

DEFINITION:
Money paused before payment because a human reviewer
needed to verify a risk indicator.

CASES: 180
AVERAGE CLAIM VALUE: R27,000
TOP RISK: Duplicate bank account
TOP INDICATOR: Cover increase before death
TOP AGENT RISK: Agent 204
TOP PROVIDER RISK: Parlour 22
```

### Step 3: Lawrence opens “Revenue Saved”

```text
REVENUE SAVED: R3,420,000

DEFINITION:
Money stopped or reduced before payout,
confirmed by Forensics and Finance.

CASES: 95
ATTRIBUTION CLASS A: 58 cases
ATTRIBUTION CLASS B: 27 cases
ATTRIBUTION CLASS C: 10 cases

CREDITABLE SAVINGS: R2,736,000
```

### Step 4: Lawrence opens “Revenue Found”

```text
REVENUE FOUND: R1,180,000

DEFINITION:
Paid claims confirmed as wrongly paid
after retrospective review.

CASES: 45
AVERAGE WRONGFUL PAYMENT: R26,222
RECOVERY POTENTIAL: R610,000
WRITE-OFF RECOMMENDED: R570,000
```

### Step 5: Lawrence opens “Revenue Recovered”

```text
REVENUE RECOVERED: R610,000

DEFINITION:
Cash that has cleared the insurer’s bank
after a wrongful payout.

CASES: 18
AVERAGE RECOVERY: R33,889
BANK RECONCILIATION: Confirmed
```

### Step 6: Lawrence opens “Future Protection”

```text
FUTURE PROTECTION:

DUPLICATE POLICIES BLOCKED: 74
DUPLICATE CLAIMS BLOCKED: 38
HIGH-RISK AGENTS RESTRICTED: 6
HIGH-RISK PROVIDERS MONITORED: 4
SYNDICATE PATTERNS DETECTED: 3
CLAIMANT EDUCATION SENT: 2,400
POLICYHOLDER EDUCATION SENT: 8,600
```

## What success looks like

For NahaShield to be a great success at Pride Life, it must deliver value in four dimensions:

| Dimension | Success measure |
|---|---|
| Revenue protection | More questionable payments stopped before payout |
| Revenue recovery | More confirmed wrongful payments recovered |
| Claims fairness | Valid claims paid quickly and fairly |
| Operational efficiency | Less manual review and fewer wasted investigations |
| Regulatory confidence | Clear audit trail, human decisions, and POPIA controls |
| Executive confidence | Finance can reproduce every rand |
| Sales confidence | Lawrence can show a clear ROI to other insurers |

A great success is not “we flagged lots of claims.” A great success is:

> “We paid valid claims faster, stopped questionable payments earlier, recovered more cash, reduced complaint risk, and gave Finance a defensible number.”

## Realistic six-month scenario

Assume Pride Life processes:

- 12,000 funeral claims over six months.
- Average claim value: R25,000.
- Total claims paid: R300 million.
- Existing fraud-detection controls already find some claims.
- NahaShield is introduced as an additional claims-stage layer.

### Conservative scenario

| Metric | Value |
|---|---:|
| Claims reviewed | 12,000 |
| Claims flagged | 320 |
| Claims held | 180 |
| Claims cleared | 120 |
| Claims declined or reduced | 60 |
| Revenue protected | R4.86 million |
| Revenue saved | R3.42 million |
| Existing-control overlap | R684,000 |
| Creditable savings | R2.736 million |
| Paid claims retrospectively reviewed | 1,200 |
| Wrongful payments found | 45 |
| Revenue found | R1.18 million |
| Recoverable amount | R610,000 |
| Revenue recovered | R610,000 |
| Total NahaShield value | R3.346 million |

### Why this is realistic

ASISA reported that insurers detected R80.8 million in fraudulent or dishonest funeral claims across 2,282 cases in 2020, implying an average detected funeral-fraud value of roughly R35,400 per case. [asisa.org](https://www.asisa.org.za/media-releases/archived-media-releases/life-insurers-report-significant-increases-in-funeral-insurance-fraud-for-2020/)

A R25,000 to R30,000 average claim value is therefore realistic for a Pride Life-style book. The scenario above assumes NahaShield finds a small, credible share of leakage rather than claiming unrealistic savings.

## Remuneration model

Because NahaLabs is paid a percentage of recovered value, the model must be carefully structured.

### Recommended model

| Component | Recommendation |
|---|---|
| Implementation fee | Optional, low or waived for first client |
| Platform fee | Fixed monthly fee, small |
| Success fee | Percentage of creditable savings and recoveries |
| Recovery-only fee | Higher percentage on cash actually recovered |
| Attribution rule | Only Class A and Class B count |
| Payment trigger | Only after Finance sign-off and bank reconciliation |
| Exclusions | Amounts already found by existing controls |
| Cap | Annual cap or tiered percentage |

### Recommended percentages

| Value type | Recommended NahaLabs fee |
|---|---:|
| Protected revenue | 0% — not billable |
| Saved revenue, Class A | 15% |
| Saved revenue, Class B | 7.5% |
| Saved revenue, Class C | 0% |
| Recovered cash | 20% |
| Retrospective found revenue | 10% |
| Future fraud prevention | 5% of verified prevented losses |

## Worked remuneration example

Using the six-month Pride Life scenario:

| Value type | Gross value | Attribution | Billable value | NahaLabs fee |
|---|---:|---:|---:|---:|
| Saved revenue, Class A | R2,040,000 | 100% | R2,040,000 | R306,000 |
| Saved revenue, Class B | R1,080,000 | 50% | R540,000 | R40,500 |
| Saved revenue, Class C | R300,000 | 0% | R0 | R0 |
| Recovered cash | R610,000 | 100% | R610,000 | R122,000 |
| Retrospective found revenue | R1,180,000 | 50% | R590,000 | R59,000 |
| **Total** |  |  | **R3,780,000** | **R527,500** |

### NahaLabs fee

```text
NahaLabs fee for six months: R527,500
Average monthly fee: R87,917
Effective fee on total NahaShield value: 15.8%
Effective fee on creditable value: 15.8%
```

## ROI for Lawrence

| Item | Value |
|---|---:|
| Total NahaShield value | R3,346,000 |
| NahaLabs fee | R527,500 |
| Net benefit to Pride Life | R2,818,500 |
| ROI | 5.34x |
| ROI percentage | 434% |
| Cost as percentage of value | 15.8% |
| Cost as percentage of claims paid | 0.18% |
| Cost as percentage of premiums | Depends on premium base |

### ROI calculation

```text
Total NahaShield value:
R3,420,000 saved
+ R610,000 recovered
= R4,030,000 gross value

Less existing-control overlap:
R684,000

Net attributable value:
R3,346,000

NahaLabs fee:
R527,500

Net benefit to Pride Life:
R2,818,500

ROI:
R2,818,500 / R527,500 = 5.34x
```

## ROI for other insurers

For a larger insurer processing 100,000 funeral claims per year:

| Metric | Annual value |
|---|---:|
| Claims reviewed | 100,000 |
| Average claim value | R25,000 |
| Total claims paid | R2.5 billion |
| Claims flagged | 2,600 |
| Claims held | 1,500 |
| Claims cleared | 1,000 |
| Claims declined or reduced | 500 |
| Revenue protected | R40.5 million |
| Revenue saved | R28.5 million |
| Existing-control overlap | R5.7 million |
| Creditable savings | R22.8 million |
| Revenue found | R9.8 million |
| Revenue recovered | R5.1 million |
| Total NahaShield value | R27.9 million |
| NahaLabs fee at 15% | R4.185 million |
| Net benefit to insurer | R23.715 million |
| ROI | 6.67x |

## What Lawrence should be able to say

After six months, Lawrence should be able to say:

> “NahaShield helped us protect R4.86 million before payment, save R3.42 million after verification, and recover R610,000 in cash. It did this without delaying legitimate claims, and every rand is traceable to a human-approved decision.”

That is the story that makes referrals possible.

## What makes NahaShield referable

NahaShield becomes referable when Lawrence can show other insurers:

1. **A clear revenue number.**  
   Protected, saved, found, and recovered are separate and auditable.

2. **A clear claims-fairness number.**  
   Valid claims are paid quickly, and complaint rates do not rise.

3. **A clear fraud-prevention number.**  
   Duplicate policies, duplicate claims, and syndicate patterns are blocked earlier.

4. **A clear recovery number.**  
   Cash actually recovered is tracked through bank reconciliation.

5. **A clear compliance story.**  
   Every decision is human-owned, explainable, and appealable.

6. **A clear ROI story.**  
   The insurer pays only when NahaShield creates verified, attributable value.

## Final positioning

NahaLabs is not selling “fraud detection.”

NahaLabs is selling **revenue protection and recovery**:

> “We help insurers stop questionable payments before they are made, recover money already lost, and prove every rand — without harming legitimate claimants.”

That is the promise Lawrence can take to Discovery, Liberty, and other insurers.
