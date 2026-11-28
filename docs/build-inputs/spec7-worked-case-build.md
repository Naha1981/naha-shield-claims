Below are the four build-ready artefacts for the **“See worked-out case example”** page: frontend components, executive deck, API payloads/responses, and automated test suite. They are designed so Lawrence can click through both cases without uploading real documents.

## 1. Frontend components

### 1.1 Page structure

```text
/see-worked-case-example
  ├── WorkedCaseLanding
  ├── WorkedCaseSelector
  ├── WorkedCaseTimeline
  ├── WorkedCaseDetail
  ├── IndicatorPanel
  ├── EvidencePanel
  ├── DecisionPanel
  ├── ValuePanel
  └── ShieldExplainer
```

### 1.2 WorkedCaseLanding

**Purpose:** Let Lawrence choose between the clean case and the fraud case.

```tsx
// src/pages/WorkedCaseLanding.tsx
import { WorkedCaseSelector } from "@/components/worked-cases/WorkedCaseSelector";
import { ExecutiveValueBoard } from "@/components/worked-cases/ExecutiveValueBoard";
import { useWorkedCases } from "@/hooks/useWorkedCases";

export function WorkedCaseLanding() {
  const { cases, isLoading } = useWorkedCases();

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold text-slate-900">
          See worked-out case example
        </h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Explore how NahaShield protects revenue, prevents fraud, and ensures
          valid claims are paid quickly. Both examples use fictional demo data.
        </p>
      </header>

      <ExecutiveValueBoard
        protectedAmount={486000000}
        savedAmount={342000000}
        recoveredAmount={61000000}
        foundAmount={118000000}
        flaggedAmount={144000000}
        clearedAmount={286000000}
      />

      <WorkedCaseSelector cases={cases} isLoading={isLoading} />
    </main>
  );
}
```

### 1.3 WorkedCaseSelector

```tsx
// src/components/worked-cases/WorkedCaseSelector.tsx
import Link from "next/link";
import { WorkedCaseSummary } from "@/types/worked-case";

type Props = {
  cases: WorkedCaseSummary[];
  isLoading: boolean;
};

export function WorkedCaseSelector({ cases, isLoading }: Props) {
  if (isLoading) {
    return <div>Loading worked examples…</div>;
  }

  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold text-slate-900">
        Choose a case to explore
      </h2>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        {cases.map((workedCase) => (
          <Link
            key={workedCase.case_id}
            href={`/see-worked-case-example/${workedCase.case_id}`}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-blue-500 hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                {workedCase.case_type}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  workedCase.outcome === "cleared"
                    ? "bg-green-100 text-green-800"
                    : "bg-red-100 text-red-800"
                }`}
              >
                {workedCase.outcome_label}
              </span>
            </div>

            <h3 className="mt-4 text-lg font-semibold text-slate-900">
              {workedCase.title}
            </h3>

            <p className="mt-2 text-sm text-slate-600">
              {workedCase.summary}
            </p>

            <dl className="mt-6 grid grid-cols-2 gap-4">
              <div>
                <dt className="text-xs text-slate-500">Claim amount</dt>
                <dd className="text-sm font-semibold">
                  R{workedCase.amount_claimed.toLocaleString()}
                </dd>
              </div>

              <div>
                <dt className="text-xs text-slate-500">Revenue protected</dt>
                <dd className="text-sm font-semibold">
                  R{workedCase.revenue_protected.toLocaleString()}
                </dd>
              </div>

              <div>
                <dt className="text-xs text-slate-500">Fraud risk</dt>
                <dd className="text-sm font-semibold">
                  {workedCase.fraud_risk}
                </dd>
              </div>

              <div>
                <dt className="text-xs text-slate-500">Decision</dt>
                <dd className="text-sm font-semibold">
                  {workedCase.decision}
                </dd>
              </div>
            </dl>

            <span className="mt-6 inline-block text-sm font-medium text-blue-600">
              View full case flow →
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
```

### 1.4 WorkedCaseDetail

```tsx
// src/pages/see-worked-case-example/[caseId].tsx
import { useRouter } from "next/router";
import { useWorkedCase } from "@/hooks/useWorkedCase";
import { CaseHeader } from "@/components/worked-cases/CaseHeader";
import { CaseTimeline } from "@/components/worked-cases/CaseTimeline";
import { IndicatorPanel } from "@/components/worked-cases/IndicatorPanel";
import { EvidencePanel } from "@/components/worked-cases/EvidencePanel";
import { DecisionPanel } from "@/components/worked-cases/DecisionPanel";
import { ValuePanel } from "@/components/worked-cases/ValuePanel";
import { ShieldExplainer } from "@/components/worked-cases/ShieldExplainer";

export default function WorkedCaseDetailPage() {
  const router = useRouter();
  const caseId = router.query.caseId as string;

  const { workedCase, isLoading, error } = useWorkedCase(caseId);

  if (isLoading) return <div>Loading case…</div>;
  if (error || !workedCase) return <div>Case not found.</div>;

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <button
        onClick={() => router.push("/see-worked-case-example")}
        className="mb-6 text-sm font-medium text-blue-600"
      >
        ← Back to worked examples
      </button>

      <CaseHeader workedCase={workedCase} />

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CaseTimeline steps={workedCase.timeline} />

          <IndicatorPanel indicators={workedCase.indicators} />

          <EvidencePanel evidence={workedCase.evidence} />

          <DecisionPanel decision={workedCase.decision} />
        </div>

        <aside className="space-y-6">
          <ValuePanel value={workedCase.value} />

          <ShieldExplainer explanation={workedCase.shield_explanation} />
        </aside>
      </div>
    </main>
  );
}
```

### 1.5 CaseHeader

```tsx
// src/components/worked-cases/CaseHeader.tsx
import type { WorkedCase } from "@/types/worked-case";

export function CaseHeader({ workedCase }: { workedCase: WorkedCase }) {
  return (
    <header className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">
            {workedCase.insurer} · {workedCase.product}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">
            {workedCase.title}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Claim reference: {workedCase.claim_reference}
          </p>
        </div>

        <div className="flex flex-col items-end">
          <span
            className={`rounded-full px-4 py-1 text-sm font-semibold ${
              workedCase.outcome === "cleared"
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            {workedCase.outcome_label}
          </span>

          <p className="mt-2 text-sm text-slate-600">
            Amount claimed: R
            {workedCase.amount_claimed.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <Metric label="Fraud risk" value={workedCase.fraud_risk} />
        <Metric label="Duplicate risk" value={workedCase.duplicate_risk} />
        <Metric label="Evidence strength" value={workedCase.evidence_strength} />
        <Metric label="Revenue protected" value={`R${workedCase.revenue_protected.toLocaleString()}`} />
      </div>
    </header>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}
```

### 1.6 CaseTimeline

```tsx
// src/components/worked-cases/CaseTimeline.tsx
import type { CaseStep } from "@/types/worked-case";

export function CaseTimeline({ steps }: { steps: CaseStep[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">Case flow</h2>

      <ol className="mt-6 space-y-6">
        {steps.map((step, index) => (
          <li key={step.step_id} className="relative pl-8">
            <span className="absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
              {index + 1}
            </span>

            <h3 className="font-semibold text-slate-900">{step.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{step.description}</p>

            {step.logic && (
              <div className="mt-3 rounded-lg bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase text-slate-500">
                  Logic
                </p>
                <p className="mt-1 text-sm text-slate-700">{step.logic}</p>
              </div>
            )}

            {step.deliverable && (
              <div className="mt-3 rounded-lg bg-blue-50 p-4">
                <p className="text-xs font-semibold uppercase text-blue-700">
                  Deliverable
                </p>
                <p className="mt-1 text-sm text-blue-900">
                  {step.deliverable}
                </p>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
```

### 1.7 IndicatorPanel

```tsx
// src/components/worked-cases/IndicatorPanel.tsx
import type { CaseIndicator } from "@/types/worked-case";

export function IndicatorPanel({
  indicators
}: {
  indicators: CaseIndicator[];
}) {
  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">
        Risk indicators
      </h2>

      {indicators.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">
          No fraud or duplicate-cover indicators were detected.
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {indicators.map((indicator) => (
            <li
              key={indicator.indicator_id}
              className="rounded-lg border border-slate-200 p-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-slate-900">
                  {indicator.title}
                </h3>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    indicator.severity === "high"
                      ? "bg-red-100 text-red-800"
                      : "bg-yellow-100 text-yellow-800"
                  }`}
                >
                  {indicator.severity}
                </span>
              </div>

              <p className="mt-2 text-sm text-slate-600">
                {indicator.description}
              </p>

              <p className="mt-2 text-sm text-slate-600">
                <strong>Innocent explanation:</strong>{" "}
                {indicator.innocent_explanation}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

## 2. Executive presentation deck

### Slide 1: Title

**NahaShield**  
*Revenue protection and recovery for funeral insurers*

**Prepared for:** Lawrence Tlowana, Pride Life SA  
**Prepared by:** NahaLabs  
**Date:** 28 November 2026  

### Slide 2: The problem

Funeral insurers face three expensive problems:

- Fraudulent claims passing through.
- Duplicate cover discovered only after payment.
- Wrongful payouts that are difficult to recover.

ASISA reported 2,282 fraudulent or dishonest funeral claims worth R80.8 million in 2020. Funeral claims made up 71% of all reported fraud cases that year. 

### Slide 3: The promise

**NahaShield helps insurers:**

- Stop questionable payments before they are made.
- Recover money already lost.
- Pay valid claims quickly and fairly.
- Prove every rand to Finance and Compliance.

### Slide 4: Two worked cases

| Case | Outcome | Revenue impact |
|---|---|---:|
| Case 1: Valid claim | Approved and paid | R0 protected |
| Case 2: Fraud pattern | Held and declined | R75,000 protected |

### Slide 5: Case 1 — valid claim

**Claim:** R25,000 funeral claim.

**What NahaShield did:**

- Verified policy, identity, death, beneficiary, and duplicate cover.
- Found no fraud indicators.
- Recommended approval.
- Human assessor approved payment.
- Claim paid within one business day.

**Result:**

- Claimant experience: Positive.
- Revenue protected: R0.
- Revenue saved: R0.
- Revenue recovered: R0.
- Compliance outcome: Compliant.

### Slide 6: Case 2 — fraud pattern

**Claim:** R75,000 funeral claim.

**What NahaShield detected:**

- Policy issued 21 days before claim.
- Cover increased ten days before death.
- SIM swap 36 hours before bank-account change.
- Same bank account linked to three unrelated claims.
- Same funeral parlour linked to 11 claims in 40 days.
- Same doctor linked to nine claims in 40 days.
- Consent evidence incomplete.

**Result:**

- Payment held before payout.
- R75,000 protected.
- R75,000 saved after investigation.
- Claim declined after human review.

### Slide 7: Revenue protection

```text
PAST 6 MONTHS — PRIDE LIFE SA

REVENUE PROTECTED: R4,860,000
REVENUE SAVED: R3,420,000
REVENUE FOUND: R1,180,000
REVENUE RECOVERED: R610,000
```

### Slide 8: Future protection

```text
DUPLICATE POLICIES BLOCKED: 74
DUPLICATE CLAIMS BLOCKED: 38
HIGH-RISK AGENTS RESTRICTED: 6
HIGH-RISK PROVIDERS MONITORED: 4
SYNDICATE PATTERNS DETECTED: 3
```

### Slide 9: ROI

| Item | Value |
|---|---:|
| Total NahaShield value | R3,346,000 |
| NahaLabs fee | R527,500 |
| Net benefit to Pride Life | R2,818,500 |
| ROI | 5.34x |
| ROI percentage | 434% |

### Slide 10: Remuneration

| Value type | NahaLabs fee |
|---|---:|
| Saved revenue, Class A | 15% |
| Saved revenue, Class B | 7.5% |
| Recovered cash | 20% |
| Retrospective found revenue | 10% |
| Future fraud prevention | 5% |

### Slide 11: Why insurers will refer

NahaShield is referable because it delivers:

- Clear revenue numbers.
- Clear claims-fairness numbers.
- Clear fraud-prevention numbers.
- Clear recovery numbers.
- Clear compliance story.
- Clear ROI story.

## 3. API payload and response JSON

### 3.1 Get worked cases

```http
GET /v1/worked-cases
```

**Response**

```json
{
  "data": [
    {
      "case_id": "worked_case_001",
      "title": "Valid funeral claim approved quickly",
      "case_type": "no_fraud",
      "insurer": "Pride Life SA",
      "product": "Funeral cover",
      "claim_reference": "CLM-2026-00421",
      "amount_claimed": 2500000,
      "fraud_risk": "low",
      "duplicate_risk": "low",
      "evidence_strength": "strong",
      "decision": "approved",
      "outcome": "cleared",
      "outcome_label": "Cleared — no fraud",
      "revenue_protected": 0,
      "revenue_saved": 0,
      "revenue_recovered": 0,
      "summary": "A valid claim was verified and paid quickly without any fraud indicators."
    },
    {
      "case_id": "worked_case_002",
      "title": "Fraud pattern detected before payment",
      "case_type": "fraud_detected",
      "insurer": "Pride Life SA",
      "product": "Funeral cover",
      "claim_reference": "CLM-2026-00887",
      "amount_claimed": 7500000,
      "fraud_risk": "high",
      "duplicate_risk": "high",
      "evidence_strength": "strong",
      "decision": "declined",
      "outcome": "fraud_prevented",
      "outcome_label": "Fraud prevented",
      "revenue_protected": 7500000,
      "revenue_saved": 7500000,
      "revenue_recovered": 0,
      "summary": "Multiple high-risk indicators were detected and payment was held before payout."
    }
  ],
  "meta": {
    "page": 1,
    "page_size": 20,
    "total": 2,
    "total_pages": 1
  }
}
```

### 3.2 Get worked case 1

```http
GET /v1/worked-cases/worked_case_001
```

**Response**

```json
{
  "data": {
    "case_id": "worked_case_001",
    "title": "Valid funeral claim approved quickly",
    "case_type": "no_fraud",
    "insurer": "Pride Life SA",
    "product": "Funeral cover",
    "claim_reference": "CLM-2026-00421",
    "policyholder": "Mrs Nomsa Dlamini",
    "deceased": "Mr Sipho Dlamini",
    "claimant": "Mrs Nomsa Dlamini",
    "relationship": "spouse",
    "agent": "Agent 118",
    "amount_claimed": 2500000,
    "amount_paid": 2500000,
    "fraud_risk": "low",
    "duplicate_risk": "low",
    "evidence_strength": "strong",
    "decision": "approved",
    "outcome": "cleared",
    "outcome_label": "Cleared — no fraud",
    "revenue_protected": 0,
    "revenue_saved": 0,
    "revenue_recovered": 0,
    "timeline": [
      {
        "step_id": "step_001",
        "title": "Claim received",
        "description": "Agent 118 submitted the claim through the agent app.",
        "logic": "Claim created and policy linked.",
        "deliverable": "Claim record created."
      },
      {
        "step_id": "step_002",
        "title": "Automated checks run",
        "description": "NahaShield ran identity, death, beneficiary, duplicate, document, and agent checks.",
        "logic": "All checks passed.",
        "deliverable": "Check results recorded."
      },
      {
        "step_id": "step_003",
        "title": "No fraud indicators",
        "description": "No fraud or duplicate-cover indicators were detected.",
        "logic": "Risk score below threshold.",
        "deliverable": "Low-risk classification."
      },
      {
        "step_id": "step_004",
        "title": "Human approval",
        "description": "Claims assessor approved payment.",
        "logic": "Human approval required before payment.",
        "deliverable": "Payment instruction issued."
      },
      {
        "step_id": "step_005",
        "title": "Claim paid",
        "description": "Claim paid to verified beneficiary.",
        "logic": "Payment released after approval.",
        "deliverable": "Claim closed as paid."
      }
    ],
    "indicators": [],
    "evidence": [
      {
        "evidence_id": "evd_001",
        "type": "policy_record",
        "class": "verified_fact",
        "description": "Policy active and premiums paid."
      },
      {
        "evidence_id": "evd_002",
        "type": "death_register",
        "class": "verified_fact",
        "description": "Death registered on 12 May 2026."
      },
      {
        "evidence_id": "evd_003",
        "type": "beneficiary_record",
        "class": "verified_fact",
        "description": "Claimant is recorded spouse and authorised beneficiary."
      }
    ],
    "decision": {
      "decision": "approved",
      "reason": "All required verification checks passed.",
      "approver": "Thabo M.",
      "approved_at": "2026-05-15T10:12:00Z"
    },
    "value": {
      "revenue_protected": 0,
      "revenue_saved": 0,
      "revenue_recovered": 0,
      "claimant_experience": "positive",
      "compliance_outcome": "compliant"
    },
    "shield_explanation": {
      "bottom_line": "This is a valid claim. All checks passed and payment was approved.",
      "why": [
        "Policy active and premiums paid.",
        "Death verified.",
        "Claimant is authorised beneficiary.",
        "No duplicate cover detected."
      ],
      "evidence": [
        {
          "type": "verified_fact",
          "description": "Policy active."
        },
        {
          "type": "verified_fact",
          "description": "Death verified."
        },
        {
          "type": "verified_fact",
          "description": "Beneficiary verified."
        }
      ],
      "innocent_explanations": [],
      "next_step": "Release payment."
    }
  },
  "meta": {
    "generated_at": "2026-11-28T07:27:00Z",
    "data_type": "fictional_demo"
  }
}
```

### 3.3 Get worked case 2

```http
GET /v1/worked-cases/worked_case_002
```

**Response**

```json
{
  "data": {
    "case_id": "worked_case_002",
    "title": "Fraud pattern detected before payment",
    "case_type": "fraud_detected",
    "insurer": "Pride Life SA",
    "product": "Funeral cover",
    "claim_reference": "CLM-2026-00887",
    "policyholder": "Mr Sibusiso Mkhize",
    "deceased": "Mr Sibusiso Mkhize",
    "claimant": "Ms Zanele Mkhize",
    "relationship": "sister",
    "agent": "Agent 204",
    "amount_claimed": 7500000,
    "amount_paid": 0,
    "fraud_risk": "high",
    "duplicate_risk": "high",
    "evidence_strength": "strong",
    "decision": "declined",
    "outcome": "fraud_prevented",
    "outcome_label": "Fraud prevented",
    "revenue_protected": 7500000,
    "revenue_saved": 7500000,
    "revenue_recovered": 0,
    "timeline": [
      {
        "step_id": "step_001",
        "title": "Claim received",
        "description": "Agent 204 submitted the claim through the agent app.",
        "logic": "Claim created and policy linked.",
        "deliverable": "Claim record created."
      },
      {
        "step_id": "step_002",
        "title": "Automated checks run",
        "description": "NahaShield ran identity, death, beneficiary, duplicate, payment, telecom, provider, and agent checks.",
        "logic": "Multiple high-risk indicators detected.",
        "deliverable": "High-risk classification."
      },
      {
        "step_id": "step_003",
        "title": "Payment held",
        "description": "Claims assessor held payment before payout.",
        "logic": "High-risk indicators require human review.",
        "deliverable": "Revenue protected."
      },
      {
        "step_id": "step_004",
        "title": "Investigation",
        "description": "Investigator reviewed evidence and linked claims.",
        "logic": "Cross-claim and provider patterns confirmed.",
        "deliverable": "Evidence pack prepared."
      },
      {
        "step_id": "step_005",
        "title": "Claim declined",
        "description": "Senior claims manager declined the claim.",
        "logic": "Material misrepresentation and invalid consent evidence.",
        "deliverable": "Revenue saved."
      }
    ],
    "indicators": [
      {
        "indicator_id": "ind_001",
        "title": "Claim submitted one day after death",
        "severity": "medium",
        "description": "Claim was submitted within 24 hours of death.",
        "innocent_explanation": "Family may have submitted the claim quickly."
      },
      {
        "indicator_id": "ind_002",
        "title": "Policy issued 21 days before claim",
        "severity": "high",
        "description": "Policy was issued shortly before the claim.",
        "innocent_explanation": "Policy may have been taken out for legitimate reasons."
      },
      {
        "indicator_id": "ind_003",
        "title": "Cover increased ten days before death",
        "severity": "high",
        "description": "Cover increased from R25,000 to R75,000 shortly before death.",
        "innocent_explanation": "Cover increase may have been legitimate."
      },
      {
        "indicator_id": "ind_004",
        "title": "SIM swap before bank-account change",
        "severity": "high",
        "description": "SIM swap occurred 36 hours before bank-account change.",
        "innocent_explanation": "SIM swap may have been legitimate."
      },
      {
        "indicator_id": "ind_005",
        "title": "Bank account linked to multiple claims",
        "severity": "high",
        "description": "Same bank account linked to three unrelated claims.",
        "innocent_explanation": "Family members may share a bank account."
      },
      {
        "indicator_id": "ind_006",
        "title": "Same funeral parlour linked to multiple claims",
        "severity": "medium",
        "description": "Same parlour linked to 11 claims in 40 days.",
        "innocent_explanation": "Busy parlour may process many legitimate claims."
      },
      {
        "indicator_id": "ind_007",
        "title": "Same doctor linked to multiple claims",
        "severity": "medium",
        "description": "Same doctor linked to nine claims in 40 days.",
        "innocent_explanation": "Doctor may serve a large community."
      },
      {
        "indicator_id": "ind_008",
        "title": "Consent evidence incomplete",
        "severity": "high",
        "description": "Consent evidence was incomplete.",
        "innocent_explanation": "Documents may have been lost or not yet submitted."
      }
    ],
    "evidence": [
      {
        "evidence_id": "evd_004",
        "type": "policy_record",
        "class": "verified_fact",
        "description": "Policy issued 21 days before claim."
      },
      {
        "evidence_id": "evd_005",
        "type": "cover_change_log",
        "class": "verified_fact",
        "description": "Cover increased ten days before death."
      },
      {
        "evidence_id": "evd_006",
        "type": "telecom_record",
        "class": "verified_fact",
        "description": "SIM swap occurred 36 hours before bank-account change."
      },
      {
        "evidence_id": "evd_007",
        "type": "payment_graph",
        "class": "verified_fact",
        "description": "Same bank account linked to three unrelated claims."
      },
      {
        "evidence_id": "evd_008",
        "type": "provider_graph",
        "class": "verified_fact",
        "description": "Same parlour linked to 11 claims in 40 days."
      },
      {
        "evidence_id": "evd_009",
        "type": "provider_graph",
        "class": "verified_fact",
        "description": "Same doctor linked to nine claims in 40 days."
      },
      {
        "evidence_id": "evd_010",
        "type": "consent_vault",
        "class": "documented_allegation",
        "description": "Consent evidence incomplete."
      }
    ],
    "decision": {
      "decision": "declined",
      "reason": "Material misrepresentation and invalid consent evidence.",
      "approver": "Naledi K.",
      "approved_at": "2026-06-09T10:00:00Z"
    },
    "value": {
      "revenue_protected": 7500000,
      "revenue_saved": 7500000,
      "revenue_recovered": 0,
      "claimant_experience": "neutral",
      "compliance_outcome": "compliant"
    },
    "shield_explanation": {
      "bottom_line": "Multiple high-risk indicators were detected. Payment was held before payout.",
      "why": [
        "Policy issued shortly before claim.",
        "Cover increased before death.",
        "SIM swap before bank-account change.",
        "Same bank account linked to multiple claims.",
        "Consent evidence incomplete."
      ],
      "evidence": [
        {
          "type": "verified_fact",
          "description": "Policy issued 21 days before claim."
        },
        {
          "type": "verified_fact",
          "description": "Cover increased before death."
        },
        {
          "type": "verified_fact",
          "description": "SIM swap before bank-account change."
        },
        {
          "type": "verified_fact",
          "description": "Same bank account linked to multiple claims."
        },
        {
          "type": "documented_allegation",
          "description": "Consent evidence incomplete."
        }
      ],
      "innocent_explanations": [
        "Family member may have changed banking details.",
        "SIM swap may have been legitimate.",
        "Funeral parlour may be high-volume.",
        "Doctor may serve a large community."
      ],
      "next_step": "Hold payment and investigate."
    }
  },
  "meta": {
    "generated_at": "2026-11-28T07:27:00Z",
    "data_type": "fictional_demo"
  }
}
```

## 4. Test suite

Save as `tests/worked-cases/worked-cases.spec.ts`.

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkedCaseLanding } from "@/pages/WorkedCaseLanding";
import { WorkedCaseDetailPage } from "@/pages/see-worked-case-example/[caseId]";

const mockCases = [
  {
    case_id: "worked_case_001",
    title: "Valid funeral claim approved quickly",
    case_type: "no_fraud",
    insurer: "Pride Life SA",
    product: "Funeral cover",
    claim_reference: "CLM-2026-00421",
    amount_claimed: 2500000,
    fraud_risk: "low",
    duplicate_risk: "low",
    evidence_strength: "strong",
    decision: "approved",
    outcome: "cleared",
    outcome_label: "Cleared — no fraud",
    revenue_protected: 0,
    revenue_saved: 0,
    revenue_recovered: 0,
    summary: "A valid claim was verified and paid quickly."
  },
  {
    case_id: "worked_case_002",
    title: "Fraud pattern detected before payment",
    case_type: "fraud_detected",
    insurer: "Pride Life SA",
    product: "Funeral cover",
    claim_reference: "CLM-2026-00887",
    amount_claimed: 7500000,
    fraud_risk: "high",
    duplicate_risk: "high",
    evidence_strength: "strong",
    decision: "declined",
    outcome: "fraud_prevented",
    outcome_label: "Fraud prevented",
    revenue_protected: 7500000,
    revenue_saved: 7500000,
    revenue_recovered: 0,
    summary: "Multiple high-risk indicators were detected."
  }
];

describe("WorkedCaseLanding", () => {
  it("renders both worked cases", () => {
    render(<WorkedCaseLanding cases={mockCases} isLoading={false} />);

    expect(screen.getByText("Valid funeral claim approved quickly")).toBeInTheDocument();
    expect(screen.getByText("Fraud pattern detected before payment")).toBeInTheDocument();
  });

  it("shows revenue protected for fraud case", () => {
    render(<WorkedCaseLanding cases={mockCases} isLoading={false} />);

    expect(screen.getByText("R75,000")).toBeInTheDocument();
  });

  it("shows zero revenue protected for clean case", () => {
    render(<WorkedCaseLanding cases={mockCases} isLoading={false} />);

    expect(screen.getAllByText("R0").length).toBeGreaterThan(0);
  });
});

describe("WorkedCaseDetailPage", () => {
  it("renders case 1 timeline", () => {
    render(<WorkedCaseDetailPage caseId="worked_case_001" />);

    expect(screen.getByText("Claim received")).toBeInTheDocument();
    expect(screen.getByText("Automated checks run")).toBeInTheDocument();
    expect(screen.getByText("No fraud indicators")).toBeInTheDocument();
  });

  it("renders case 2 indicators", () => {
    render(<WorkedCaseDetailPage caseId="worked_case_002" />);

    expect(screen.getByText("Claim submitted one day after death")).toBeInTheDocument();
    expect(screen.getByText("Policy issued 21 days before claim")).toBeInTheDocument();
    expect(screen.getByText("Cover increased ten days before death")).toBeInTheDocument();
  });

  it("does not use accusation wording", () => {
    render(<WorkedCaseDetailPage caseId="worked_case_002" />);

    expect(screen.queryByText(/fraudster/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/criminal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/guilty/i)).not.toBeInTheDocument();
  });
});
```

React Testing Library recommends using `userEvent` for realistic interaction simulation. [react-spectrum.adobe](https://react-spectrum.adobe.com/testing)

## 5. Step-by-step UI flow

### Step 1: Lawrence opens the app

Lawrence logs in and lands on the **Executive Value Board**.

```text
PAST 6 MONTHS — PRIDE LIFE SA

REVENUE PROTECTED: R4,860,000
REVENUE SAVED: R3,420,000
REVENUE FOUND: R1,180,000
REVENUE RECOVERED: R610,000
```

### Step 2: Lawrence clicks “See worked-out case example”

He sees two cards:

```text
Case 1: Valid funeral claim approved quickly
Case 2: Fraud pattern detected before payment
```

### Step 3: Lawrence clicks Case 1

He sees:

```text
CLAIM STATUS: APPROVED AND PAID
AMOUNT CLAIMED: R25,000
FRAUD RISK: LOW
DUPLICATE RISK: LOW
EVIDENCE STRENGTH: STRONG
REVENUE PROTECTED: R0
```

He can click through:

1. Claim received.
2. Automated checks.
3. No fraud indicators.
4. Human approval.
5. Claim paid.

### Step 4: Lawrence clicks Case 2

He sees:

```text
CLAIM STATUS: HELD FOR INVESTIGATION
AMOUNT CLAIMED: R75,000
FRAUD RISK: HIGH
DUPLICATE RISK: HIGH
EVIDENCE STRENGTH: STRONG
REVENUE PROTECTED: R75,000
```

He can click through:

1. Claim received.
2. Automated checks.
3. Payment held.
4. Investigation.
5. Claim declined.

### Step 5: Lawrence views indicators

He sees:

```text
Claim submitted one day after death
Policy issued 21 days before claim
Cover increased ten days before death
SIM swap before bank-account change
Bank account linked to multiple claims
Same funeral parlour linked to multiple claims
Same doctor linked to multiple claims
Consent evidence incomplete
```

### Step 6: Lawrence views evidence

He sees:

```text
Policy record
Cover-change log
Telecom record
Payment graph
Provider graph
Consent vault
```

### Step 7: Lawrence views decision

He sees:

```text
Decision: Declined
Reason: Material misrepresentation and invalid consent evidence
Approver: Naledi K.
Revenue protected: R75,000
Revenue saved: R75,000
Revenue recovered: R0
```

### Step 8: Lawrence views Shield explanation

He sees:

```text
Bottom line:
Multiple high-risk indicators were detected.
Payment was held before payout.

Why:
Policy issued shortly before claim.
Cover increased before death.
SIM swap before bank-account change.
Same bank account linked to multiple claims.
Consent evidence incomplete.

Innocent explanations:
Family member may have changed banking details.
SIM swap may have been legitimate.
Funeral parlour may be high-volume.
Doctor may serve a large community.

Next step:
Hold payment and investigate.
```

## 6. Sources

- React Testing Library and user-event guidance for realistic interaction testing. [react-spectrum.adobe](https://react-spectrum.adobe.com/testing)
- REST API response envelope, pagination, and error-shape best practices. [paulund.co](https://paulund.co.uk/notebook/apis/rest-api-response-shape)
- Dashboard UI guidance: tables for scannable records and useful empty states. [ui.neuctra](https://ui.neuctra.com/blog/react-saas-dashboard-components-cards-stats-tables)
