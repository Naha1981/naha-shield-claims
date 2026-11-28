Below are the implementation specifications for the five requested areas. They are designed to slot directly into **NahaShield PRD v1.2** as sections 26–30.

## 1. Recovery action API endpoints

### API principles

- All endpoints require OAuth 2.0 authentication.
- All endpoints enforce tenant, role, and object-level authorisation.
- All mutating endpoints require an `Idempotency-Key`.
- All endpoints return a correlation ID for tracing.
- All sensitive fields are pseudonymised or redacted in logs.
- No endpoint may automatically repudiate a claim, accuse a person, or initiate recovery without human approval.
- Recovery cash is recognised only after bank reconciliation confirms cleared funds.

OWASP requires object-level authorisation on every request, and Microsoft recommends idempotency and consistent error handling for REST APIs. [learn.microsoft](https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-implementation)

### Base URL

```http
https://api.nahashield.co.za/v1
```

### Authentication

```http
Authorization: Bearer <access_token>
X-Tenant-ID: <tenant_id>
Idempotency-Key: <uuid>
X-Request-ID: <uuid>
```

### Recovery object model

```json
{
  "recovery_case_id": "rcv_01H...",
  "claim_id": "clm_01H...",
  "policy_id": "pol_01H...",
  "tenant_id": "ten_01H...",
  "status": "open",
  "amount_paid": 8000000,
  "amount_recovered": 0,
  "amount_written_off": 0,
  "net_realisable_value": -3000000,
  "estimated_recovery": 1500000,
  "estimated_cost": 4500000,
  "recommended_route": "write_off",
  "owner_id": "usr_01H...",
  "created_at": "2026-11-28T07:00:00Z",
  "updated_at": "2026-11-28T07:00:00Z"
}
```

### 1.1 Create recovery case

```http
POST /v1/recovery-cases
```

Creates a recovery case after a claim has been confirmed as wrongly paid.

**Request**

```json
{
  "claim_id": "clm_01H...",
  "reason": "confirmed_fraudulent_payment",
  "amount_paid_cents": 8000000,
  "evidence_ids": ["evd_01H...", "evd_02H..."],
  "initial_route": "internal_review",
  "notes": "Payment confirmed as wrongful after investigation."
}
```

**Response**

```json
{
  "recovery_case_id": "rcv_01H...",
  "status": "open",
  "amount_paid_cents": 8000000,
  "amount_recovered_cents": 0,
  "amount_written_off_cents": 0,
  "net_realisable_value_cents": null,
  "recommended_route": "internal_review",
  "created_at": "2026-11-28T07:00:00Z"
}
```

**Permissions**

| Role | Permission |
|---|---|
| Claims manager | Create |
| Investigator | Create |
| Head of Recoveries | Create |
| Finance | Read |
| Compliance | Read |
| Executive | Read |

### 1.2 List recovery cases

```http
GET /v1/recovery-cases
```

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `status` | string | `open`, `investigating`, `pending_approval`, `pursuing`, `closed_recovered`, `closed_written_off` |
| `route` | string | `internal_review`, `demand_letter`, `civil_claim`, `compensation_order`, `criminal_referral`, `write_off` |
| `min_amount_cents` | integer | Minimum amount paid |
| `max_amount_cents` | integer | Maximum amount paid |
| `owner_id` | string | Assigned recovery owner |
| `page` | integer | Page number |
| `page_size` | integer | Maximum 100 |

**Response**

```json
{
  "items": [
    {
      "recovery_case_id": "rcv_01H...",
      "claim_id": "clm_01H...",
      "status": "open",
      "amount_paid_cents": 8000000,
      "amount_recovered_cents": 0,
      "net_realisable_value_cents": -3000000,
      "recommended_route": "write_off"
    }
  ],
  "page": 1,
  "page_size": 25,
  "total_count": 42
}
```

### 1.3 Get recovery case

```http
GET /v1/recovery-cases/{recovery_case_id}
```

Returns the full recovery case, including evidence, timeline, valuation, decisions, and audit references.

### 1.4 Update recovery case

```http
PATCH /v1/recovery-cases/{recovery_case_id}
```

Updates non-financial fields such as owner, route, notes, and status.

**Request**

```json
{
  "owner_id": "usr_01H...",
  "route": "civil_claim",
  "status": "investigating",
  "notes": "Asset and income tracing requested."
}
```

### 1.5 Add recovery evidence

```http
POST /v1/recovery-cases/{recovery_case_id}/evidence
```

**Request**

```json
{
  "evidence_type": "bank_statement",
  "source": "insurer_finance",
  "document_id": "doc_01H...",
  "description": "Bank statement confirming payment",
  "hash": "sha256:..."
}
```

### 1.6 Calculate recovery valuation

```http
POST /v1/recovery-cases/{recovery_case_id}/valuation
```

Calculates estimated sale proceeds, costs, net realisable value, and recommended route.

**Request**

```json
{
  "asset_type": "rural_property",
  "tenure_type": "permission_to_occupy",
  "estimated_sale_proceeds_cents": 1500000,
  "legal_costs_cents": 4500000,
  "auction_costs_cents": 0,
  "outstanding_bond_cents": 0,
  "arrears_cents": 0,
  "probability_of_recovery": 0.15,
  "time_to_recovery_months": 18
}
```

**Response**

```json
{
  "net_realisable_value_cents": -3000000,
  "expected_value_cents": -2775000,
  "recommended_route": "write_off",
  "confidence": "medium",
  "reason": "Estimated recovery is materially below estimated legal and recovery costs."
}
```

### 1.7 Recommend recovery route

```http
POST /v1/recovery-cases/{recovery_case_id}/route-recommendation
```

**Response**

```json
{
  "recommended_route": "compensation_order",
  "alternative_routes": [
    "civil_claim",
    "write_off"
  ],
  "reason": "Asset value is low, but a compensation order may be viable if the respondent has income or assets.",
  "evidence_gaps": [
    "employment_income",
    "bank_account_ownership",
    "asset_register"
  ],
  "human_approval_required": true
}
```

### 1.8 Approve recovery route

```http
POST /v1/recovery-cases/{recovery_case_id}/route-approval
```

**Request**

```json
{
  "route": "compensation_order",
  "decision": "approve",
  "approver_id": "usr_01H...",
  "reason": "Respondent has identifiable income and a compensation order is viable.",
  "evidence_ids": ["evd_01H..."]
}
```

### 1.9 Create recovery action

```http
POST /v1/recovery-cases/{recovery_case_id}/actions
```

Creates an action such as demand letter, tracing instruction, litigation instruction, or compensation-order application.

**Request**

```json
{
  "action_type": "demand_letter",
  "recipient_type": "claimant",
  "recipient_id": "psn_01H...",
  "channel": "email",
  "template_id": "tpl_recovery_demand_v1",
  "scheduled_for": "2026-11-29T09:00:00Z",
  "approval_required": true
}
```

### 1.10 Approve recovery action

```http
POST /v1/recovery-cases/{recovery_case_id}/actions/{action_id}/approval
```

**Request**

```json
{
  "decision": "approve",
  "approver_id": "usr_01H...",
  "reason": "Approved for dispatch after legal review."
}
```

### 1.11 Record recovery payment

```http
POST /v1/recovery-cases/{recovery_case_id}/payments
```

Records an inbound recovery payment.

**Request**

```json
{
  "payment_reference": "BANK-REF-001",
  "amount_cents": 2500000,
  "received_at": "2026-11-28T07:00:00Z",
  "bank_statement_id": "bnk_01H...",
  "reconciliation_status": "pending"
}
```

### 1.12 Reconcile recovery payment

```http
POST /v1/recovery-cases/{recovery_case_id}/payments/{payment_id}/reconcile
```

**Request**

```json
{
  "bank_statement_line_id": "bnk_line_01H...",
  "matched_amount_cents": 2500000,
  "matched_by": "usr_01H...",
  "notes": "Matched to insurer bank account."
}
```

**Response**

```json
{
  "payment_id": "pay_01H...",
  "reconciliation_status": "cleared",
  "amount_recovered_cents": 2500000,
  "ledger_status": "recovered",
  "cleared_at": "2026-11-28T07:00:00Z"
}
```

### 1.13 Write off recovery case

```http
POST /v1/recovery-cases/{recovery_case_id}/write-off
```

**Request**

```json
{
  "amount_written_off_cents": 8000000,
  "reason": "Net realisable value is negative and no viable recovery route exists.",
  "approver_id": "usr_01H...",
  "evidence_ids": ["evd_01H..."]
}
```

### 1.14 Close recovery case

```http
POST /v1/recovery-cases/{recovery_case_id}/close
```

**Request**

```json
{
  "closure_reason": "recovered",
  "amount_recovered_cents": 2500000,
  "amount_written_off_cents": 5500000,
  "approver_id": "usr_01H..."
}
```

### 1.15 Recovery audit trail

```http
GET /v1/recovery-cases/{recovery_case_id}/audit
```

Returns a hash-chained audit trail.

### 1.16 Recovery webhook events

| Event | Trigger |
|---|---|
| `recovery_case.created` | Recovery case created |
| `recovery_case.route_recommended` | Route recommendation generated |
| `recovery_case.route_approved` | Route approved |
| `recovery_case.action_created` | Recovery action created |
| `recovery_case.action_approved` | Recovery action approved |
| `recovery_case.payment_received` | Payment recorded |
| `recovery_case.payment_cleared` | Bank reconciliation confirmed |
| `recovery_case.written_off` | Write-off approved |
| `recovery_case.closed` | Case closed |

## 2. Claims workspace database schema

### Design principles

- PostgreSQL is the system of record.
- All money is stored as integer cents.
- Every table carries `tenant_id`.
- Every sensitive action is audit-logged.
- Every adverse action stores approver, reason, evidence, and appeal rights.
- No raw ID numbers, banking details, or biometric templates are stored in plaintext.

### 2.1 Tenants and users

```sql
CREATE TABLE tenants (
  tenant_id UUID PRIMARY KEY,
  tenant_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  user_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  email_hash TEXT NOT NULL,
  full_name_encrypted TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_role_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(user_id),
  role TEXT NOT NULL,
  granted_by UUID NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
```

### 2.2 Claims workspace

```sql
CREATE TABLE claims (
  claim_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  policy_id UUID NOT NULL,
  claim_number TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  status TEXT NOT NULL,
  amount_claimed_cents BIGINT NOT NULL DEFAULT 0,
  amount_approved_cents BIGINT NOT NULL DEFAULT 0,
  amount_paid_cents BIGINT NOT NULL DEFAULT 0,
  amount_reduced_cents BIGINT NOT NULL DEFAULT 0,
  amount_recovered_cents BIGINT NOT NULL DEFAULT 0,
  fraud_risk_score NUMERIC(5,2),
  evidence_strength_score NUMERIC(5,2),
  clock_status TEXT,
  clock_due_at TIMESTAMPTZ,
  owner_id UUID,
  submitted_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE claim_events (
  event_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  event_type TEXT NOT NULL,
  actor_id UUID,
  actor_role TEXT,
  payload JSONB NOT NULL,
  previous_hash TEXT,
  event_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE claim_documents (
  document_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  document_type TEXT NOT NULL,
  storage_reference TEXT NOT NULL,
  sha256_hash TEXT NOT NULL,
  perceptual_hash TEXT,
  uploaded_by UUID,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verification_status TEXT,
  verification_result JSONB
);

CREATE TABLE claim_indicators (
  indicator_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  rule_id TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  severity TEXT NOT NULL,
  risk_score NUMERIC(5,2),
  status TEXT NOT NULL,
  evidence_ids UUID[],
  innocent_explanations JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolution TEXT
);
```

### 2.3 Adverse actions and appeals

```sql
CREATE TABLE adverse_actions (
  adverse_action_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  action_type TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_text TEXT NOT NULL,
  status TEXT NOT NULL,
  proposed_by UUID NOT NULL,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  effective_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  evidence_ids UUID[],
  claimant_notified BOOLEAN DEFAULT false,
  appeal_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE appeals (
  appeal_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  adverse_action_id UUID NOT NULL REFERENCES adverse_actions(adverse_action_id),
  claimant_id UUID NOT NULL,
  appeal_reason TEXT NOT NULL,
  status TEXT NOT NULL,
  reviewer_id UUID,
  reviewer_role TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  outcome TEXT,
  outcome_reason TEXT,
  evidence_ids UUID[]
);

CREATE TABLE claimant_notifications (
  notification_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  recipient_id UUID NOT NULL,
  channel TEXT NOT NULL,
  template_id TEXT NOT NULL,
  status TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  approved_by UUID,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.4 Recovery schema

```sql
CREATE TABLE recovery_cases (
  recovery_case_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  status TEXT NOT NULL,
  route TEXT,
  amount_paid_cents BIGINT NOT NULL,
  amount_recovered_cents BIGINT NOT NULL DEFAULT 0,
  amount_written_off_cents BIGINT NOT NULL DEFAULT 0,
  estimated_recovery_cents BIGINT,
  estimated_cost_cents BIGINT,
  net_realisable_value_cents BIGINT,
  probability_of_recovery NUMERIC(5,4),
  owner_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recovery_actions (
  recovery_action_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  recovery_case_id UUID NOT NULL REFERENCES recovery_cases(recovery_case_id),
  action_type TEXT NOT NULL,
  recipient_type TEXT,
  recipient_id UUID,
  channel TEXT,
  template_id TEXT,
  status TEXT NOT NULL,
  approval_required BOOLEAN DEFAULT true,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recovery_payments (
  recovery_payment_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  recovery_case_id UUID NOT NULL REFERENCES recovery_cases(recovery_case_id),
  payment_reference TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  bank_statement_id UUID,
  reconciliation_status TEXT NOT NULL,
  reconciled_by UUID,
  reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recovery_valuations (
  valuation_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  recovery_case_id UUID NOT NULL REFERENCES recovery_cases(recovery_case_id),
  asset_type TEXT,
  tenure_type TEXT,
  estimated_sale_proceeds_cents BIGINT,
  legal_costs_cents BIGINT,
  auction_costs_cents BIGINT,
  outstanding_bond_cents BIGINT,
  arrears_cents BIGINT,
  probability_of_recovery NUMERIC(5,4),
  net_realisable_value_cents BIGINT,
  recommended_route TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.5 Duplicate detection schema

```sql
CREATE TABLE duplicate_signals (
  duplicate_signal_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  rule_id TEXT NOT NULL,
  match_type TEXT NOT NULL,
  match_confidence NUMERIC(5,4),
  matched_entity_type TEXT NOT NULL,
  matched_entity_id UUID NOT NULL,
  related_claim_id UUID,
  related_policy_id UUID,
  evidence_ids UUID[],
  innocent_explanations JSONB,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolution TEXT
);

CREATE TABLE duplicate_matches (
  duplicate_match_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  source_claim_id UUID NOT NULL,
  target_claim_id UUID,
  target_policy_id UUID,
  match_type TEXT NOT NULL,
  match_score NUMERIC(5,4),
  matched_fields JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 3. Incident response plan for false flags

### Purpose

Ensure that a false flag does not become an unfair delay, wrongful decline, reputational harm, or regulatory breach.

### Severity levels

| Severity | Definition | Response time |
|---|---|---:|
| **S1 — Critical** | False flag caused payment delay, wrongful decline, claimant harm, or public exposure | 1 hour |
| **S2 — High** | False flag affected a material claim or multiple claimants | 4 hours |
| **S3 — Medium** | False flag identified internally before claimant impact | 1 business day |
| **S4 — Low** | Isolated false positive with no claimant impact | 3 business days |

### Incident roles

| Role | Responsibility |
|---|---|
| Incident commander | Coordinates response |
| Claims owner | Owns claimant impact and remedy |
| AI/model owner | Owns model or agent failure |
| Compliance officer | Owns POPIA and regulatory assessment |
| Legal | Owns claimant communication and legal exposure |
| Security engineer | Owns technical containment |
| Data engineer | Owns data correction |
| Communications | Owns internal and external messaging |

### Detection triggers

A false-flag incident may be triggered by:

- Claimant appeal upheld.
- Claim released after hold.
- Human override rate exceeds threshold.
- False-positive rate exceeds threshold.
- Complaint alleges unfair treatment.
- Model drift alert.
- Rule misconfiguration.
- Data-quality error.
- Duplicate-match false positive.
- Agent hallucination or incorrect explanation.
- Unauthorised access to evidence.

### Response workflow

```text
1. Detect false flag
2. Classify severity
3. Freeze affected automated action
4. Preserve evidence
5. Assess claimant impact
6. Correct claim status
7. Notify claimant if affected
8. Root-cause analysis
9. Correct rule, model, or data
10. Test fix
11. Resume affected workflow
12. Report and close incident
```

### Immediate actions

Within one hour for S1:

- Disable the affected rule, model, agent, or integration.
- Freeze any pending adverse action.
- Identify all affected claims and claimants.
- Preserve logs, evidence, model inputs, and outputs.
- Notify the incident commander and claims owner.
- Assign a human reviewer to every affected claim.
- Prevent further automated adverse actions.

### Claimant remedy

If a claimant was affected:

- Release the hold immediately if the claim is valid.
- Restore the claim to its correct status.
- Reverse any wrongful reduction or decline.
- Send a neutral apology and explanation.
- Offer expedited processing.
- Record the remedy in the appeal and audit log.
- Do not use wording that implies wrongdoing.

### Root-cause analysis

Within five business days, document:

- What triggered the false flag.
- Which rule, model, agent, or data source caused it.
- How many claims were affected.
- Whether claimants were harmed.
- Whether money was wrongly withheld, reduced, or declined.
- What control failed.
- What corrective action was taken.
- What preventive control was added.
- Whether the incident must be reported.

### POPIA assessment

If personal information may have been accessed or acquired by an unauthorised person, the responsible party must notify the Information Regulator and affected data subjects as soon as reasonably possible. The notification must explain the compromise, affected information, possible consequences, and remedial steps. [linkedin](https://www.linkedin.com/in/lawrence-tlowana-6b8a7082)

### Prevention controls

- Every flag requires human review before adverse action.
- Every adverse action requires evidence strength above the configured threshold.
- Every model and rule has a kill switch.
- Every false positive is logged and classified.
- Every appeal overturn triggers root-cause analysis.
- Every model change requires regression testing.
- Every claimant-facing message requires approval.
- Every incident is tracked to closure.

## 4. Cross-claim matching test cases

### Test objective

Ensure that duplicate detection catches real duplicate risk without creating excessive false positives.

### Test data set

Create a synthetic test set with:

- 1,000 clean claims.
- 100 duplicate claims.
- 50 duplicate policies.
- 25 mule-account cases.
- 25 shared-agent cases.
- 25 shared-device cases.
- 25 shared-address cases.
- 25 innocent-control cases.

### Test cases

| Test ID | Scenario | Expected result |
|---|---|---|
| TC-DUP-001 | Same deceased ID on two claims | High-risk duplicate signal |
| TC-DUP-002 | Same deceased ID on two policies | High-risk duplicate signal |
| TC-DUP-003 | Same claimant on two unrelated claims | Medium-to-high risk |
| TC-DUP-004 | Same beneficiary on two unrelated claims | Medium-to-high risk |
| TC-DUP-005 | Same bank account on multiple payouts | High-risk duplicate signal |
| TC-DUP-006 | Same phone number on multiple claims | Medium risk |
| TC-DUP-007 | Same device on multiple claims | Medium risk |
| TC-DUP-008 | Same address on multiple unrelated claims | Medium risk |
| TC-DUP-009 | Same agent on multiple duplicate policies | High agent-risk signal |
| TC-DUP-010 | Same funeral parlour on multiple suspicious claims | Provider-review signal |
| TC-DUP-011 | Same doctor or certifier on multiple claims | Provider-review signal |
| TC-DUP-012 | Claim submitted within 48 hours of issue | High-risk timing signal |
| TC-DUP-013 | Claim submitted within seven days of cover increase | High-risk timing signal |
| TC-DUP-014 | Same document hash on multiple claims | High-risk document signal |
| TC-DUP-015 | Same perceptual hash on multiple claims | High-risk document signal |
| TC-DUP-016 | Similar names but different ID numbers | No adverse action |
| TC-DUP-017 | Same surname but different people | No adverse action |
| TC-DUP-018 | Same household address but different insured lives | Monitor only |
| TC-DUP-019 | Shared family phone but different claimants | Monitor only |
| TC-DUP-020 | Same funeral parlour but no other link | Monitor only |
| TC-DUP-021 | Same doctor but no other link | Monitor only |
| TC-DUP-022 | Same agent but no other link | Monitor only |
| TC-DUP-023 | Duplicate claim across insurers | Cross-market referral |
| TC-DUP-024 | Duplicate policy across insurers | Cross-market referral |
| TC-DUP-025 | Same bank account but legitimate family account | Human review required |
| TC-DUP-026 | Same device but shared household device | Human review required |
| TC-DUP-027 | Same address but informal settlement | Human review required |
| TC-DUP-028 | Same agent but high-volume legitimate book | Peer baseline required |
| TC-DUP-029 | Same parlour but high-volume legitimate book | Peer baseline required |
| TC-DUP-030 | Same claimant but legitimate multiple policies | Human review required |

### Test assertions

For each test case, assert:

- Correct match type.
- Correct risk score.
- Correct action.
- Correct innocent explanations.
- Correct evidence links.
- Correct audit event.
- No automatic adverse action.
- No accusation wording.
- Correct tenant isolation.
- Correct appeal availability.

### Quality thresholds

| Metric | Target |
|---|---|
| Precision | At least 80% on adjudicated candidates |
| Recall | At least 70% on known duplicate cases |
| False-positive rate | Below agreed insurer threshold |
| Clean-control false-positive rate | Below agreed insurer threshold |
| Human-review rate | Monitored, not automatically adverse |
| Appeal overturn rate | Monitored and reported |

## 5. Role-based access control matrix

### Design principles

- Access is granted by role, tenant, and object.
- Every request is authorised on the backend.
- No role may access another tenant’s data.
- Sensitive evidence requires need-to-know access.
- Every access event is logged.
- Every adverse action requires explicit approval rights.

OWASP requires object-level authorisation on every request and recommends RBAC policies that define which roles may access or modify specific objects. [f6s](https://www.f6s.com/member/lawrencetlowana)

### Role definitions

| Role | Description |
|---|---|
| **Policyholder** | Views own policy and claim status |
| **Beneficiary** | Submits and tracks claim |
| **Agent** | Creates and submits claims |
| **Claims assessor** | Reviews and decides claims |
| **Claims manager** | Approves holds, escalations, and decisions |
| **Investigator** | Investigates flagged claims |
| **Senior investigator** | Approves serious investigations |
| **Head of Recoveries** | Owns recovery strategy |
| **Finance partner** | Confirms savings and recoveries |
| **Compliance officer** | Owns POPIA, audit, and control gaps |
| **Legal** | Reviews adverse actions and referrals |
| **Executive** | Read-only value and trend view |
| **Insurer administrator** | Manages users and configuration |
| **NahaLabs support** | Limited technical support, no evidence access by default |

### Permission matrix

| Capability | Policyholder | Beneficiary | Agent | Assessor | Claims manager | Investigator | Recoveries | Finance | Compliance | Legal | Executive | Admin |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| View own policy | Yes | No | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| View own claim | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Submit claim | No | Yes | Yes | No | No | No | No | No | No | No | No | No |
| Upload claim document | No | Yes | Yes | Yes | Yes | Yes | No | No | No | No | No | No |
| View claim indicators | No | No | No | Yes | Yes | Yes | Yes | No | Yes | Yes | Summary | No |
| View evidence | No | Limited | Limited | Yes | Yes | Yes | Yes | Limited | Yes | Yes | Summary | No |
| Raise indicator | No | No | No | Yes | Yes | Yes | No | No | No | No | No | No |
| Hold claim | No | No | No | Yes | Yes | No | No | No | No | No | No | No |
| Request documents | No | No | No | Yes | Yes | Yes | No | No | No | No | No | No |
| Escalate claim | No | No | No | Yes | Yes | Yes | No | No | No | No | No | No |
| Approve hold | No | No | No | No | Yes | No | No | No | No | No | No | No |
| Reduce claim | No | No | No | No | Yes | No | No | No | No | Yes | No | No |
| Decline claim | No | No | No | No | Yes | No | No | No | No | Yes | No | No |
| Refer to SAPS | No | No | No | No | No | Yes | No | No | Yes | Yes | No | No |
| View recovery case | No | No | No | No | Yes | Yes | Yes | Yes | Yes | Yes | Summary | No |
| Create recovery case | No | No | No | No | Yes | Yes | Yes | No | No | No | No | No |
| Recommend recovery route | No | No | No | No | No | No | Yes | No | No | No | No | No |
| Approve recovery route | No | No | No | No | No | No | Yes | No | No | Yes | No | No |
| Record recovery payment | No | No | No | No | No | No | Yes | Yes | No | No | No | No |
| Reconcile recovery payment | No | No | No | No | No | No | Yes | Yes | No | No | No | No |
| Write off recovery | No | No | No | No | No | No | Yes | No | No | Yes | No | No |
| Confirm saving | No | No | No | No | No | No | No | Yes | No | No | No | No |
| View savings ledger | No | No | No | No | Yes | No | Yes | Yes | Yes | No | Yes | No |
| View audit log | No | No | No | Limited | Limited | Limited | Limited | Limited | Yes | Yes | No | Yes |
| Manage users | No | No | No | No | No | No | No | No | No | No | No | Yes |
| Manage integrations | No | No | No | No | No | No | No | No | No | No | No | Yes |
| Manage model thresholds | No | No | No | No | No | No | No | No | Yes | No | No | No |
| Approve model change | No | No | No | No | No | No | No | No | Yes | No | No | No |
| Kill switch | No | No | No | No | No | No | No | No | Yes | No | No | Yes |

### Object-level rules

- A user may access only objects within their tenant.
- An agent may access only claims they originated or are assigned to.
- An assessor may access only claims assigned to their team.
- An investigator may access only cases assigned to them or their team.
- Finance may access ledger and reconciliation data but not full claim evidence unless explicitly granted.
- Compliance may access audit, consent, and control data.
- Legal may access adverse-action and referral evidence.
- Executives receive aggregated value data, not raw evidence by default.
- NahaLabs support has no evidence access unless explicitly time-bound and approved.

### Audit requirements

Log every:

- Login attempt.
- Failed authorisation.
- Evidence view.
- Claim decision.
- Hold.
- Appeal.
- Recovery action.
- Payment reconciliation.
- Model score.
- Agent response.
- Configuration change.
- Kill-switch action.

Logs must exclude credentials, tokens, and sensitive personal data. They must include enough context to identify the actor, object, purpose, and outcome. [learn.microsoft](https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-implementation)

## 6. Sources

- Lawrence Tlowana public profile: Director, Sales & Distribution at Pride Life; earlier Discovery Health and Liberty Life experience. 
- Pride Life SA public profile: Johannesburg insurance brokerage, founded 2015, funeral-cover focus, agent recruitment. 
- South African funeral-insurance fraud and duplicate-cover context: Actuarial Society, FSCA, FAIS Ombud, and industry reporting. 
- Cross-market claims-fraud detection: XTND Veritas. 
- Biometric identity verification: Iriscan and Home Affairs ABIS. 
- POPIA automated-decision and breach-notification requirements: POPIA section 71 and section 22. [linkedin](https://www.linkedin.com/in/lawrence-tlowana-6b8a7082)
- AI governance and human oversight: NIST AI RMF. 
- API security and authorisation: OWASP API Security Top 10 and REST Security Cheat Sheet. [f6s](https://www.f6s.com/member/lawrencetlowana)
