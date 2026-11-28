Below are the remaining implementation specifications for **NahaShield v1.2**. They are written to be directly implementable: API endpoints, database schema and indexes, communication templates, investigator frontend components, and cross-claim matching test payloads.

## 1. Remaining API endpoints

### API conventions

- Base URL: `https://api.nahashield.co.za/v1`
- All endpoints require `Authorization: Bearer <token>`.
- All requests include `X-Tenant-ID`.
- All mutating requests require `Idempotency-Key`.
- All responses include `X-Request-ID`.
- Pagination is server-side, with a maximum page size of 100.
- Errors use a consistent envelope and do not expose internal details.
- Filtering and pagination are applied in the database, not after loading a full collection. [learn.microsoft](https://learn.microsoft.com/en-ca/azure/architecture/best-practices/api-implementation)

### Error envelope

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields are invalid.",
    "details": [
      {
        "field": "amount_claimed_cents",
        "issue": "must_be_positive_integer"
      }
    ],
    "request_id": "req_01H...",
    "documentation_url": "https://docs.nahashield.co.za/errors"
  }
}
```

### Standard status codes

| Code | Meaning |
|---:|---|
| 200 | Success |
| 201 | Created |
| 202 | Accepted for async processing |
| 204 | No content |
| 400 | Validation error |
| 401 | Unauthenticated |
| 403 | Forbidden |
| 404 | Not found |
| 409 | Conflict |
| 422 | Business-rule violation |
| 429 | Rate limited |
| 500 | Internal error |
| 503 | Dependent service unavailable |

## 2. Claims API

### 2.1 Create claim

```http
POST /v1/claims
```

**Request**

```json
{
  "policy_id": "pol_01H...",
  "claim_type": "funeral",
  "deceased_person_id": "psn_01H...",
  "claimant_person_id": "psn_02H...",
  "date_of_death": "2026-11-20",
  "amount_claimed_cents": 7500000,
  "channel": "agent_app",
  "agent_id": "agt_01H...",
  "documents": [
    {
      "document_type": "death_certificate",
      "storage_reference": "s3://nahashield-docs/doc_01H...",
      "sha256_hash": "sha256:..."
    }
  ]
}
```

**Response**

```json
{
  "claim_id": "clm_01H...",
  "status": "received",
  "clock_status": "running",
  "clock_due_at": "2026-12-02T16:00:00Z",
  "fraud_risk_score": null,
  "duplicate_risk_score": null,
  "created_at": "2026-11-28T07:00:00Z"
}
```

### 2.2 Get claim

```http
GET /v1/claims/{claim_id}
```

**Response**

```json
{
  "claim_id": "clm_01H...",
  "policy_id": "pol_01H...",
  "status": "under_review",
  "amount_claimed_cents": 7500000,
  "amount_approved_cents": 0,
  "amount_paid_cents": 0,
  "fraud_risk_score": 72.5,
  "evidence_strength_score": 48.0,
  "clock_status": "running",
  "clock_due_at": "2026-12-02T16:00:00Z",
  "owner_id": "usr_01H...",
  "indicators": [
    {
      "indicator_id": "ind_01H...",
      "rule_id": "DUP-01",
      "severity": "high",
      "status": "open",
      "summary": "Same deceased ID appears on another claim."
    }
  ],
  "next_action": "review_duplicate_signal"
}
```

### 2.3 List claims

```http
GET /v1/claims
```

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `status` | string | `received`, `under_review`, `on_hold`, `approved`, `declined`, `paid`, `closed` |
| `risk_level` | string | `low`, `medium`, `high` |
| `clock_status` | string | `running`, `due_soon`, `overdue`, `paused` |
| `owner_id` | string | Assigned user |
| `agent_id` | string | Originating agent |
| `min_amount_cents` | integer | Minimum claimed amount |
| `max_amount_cents` | integer | Maximum claimed amount |
| `submitted_from` | date | ISO date |
| `submitted_to` | date | ISO date |
| `sort` | string | `submitted_at`, `clock_due_at`, `amount_claimed_cents`, `fraud_risk_score` |
| `order` | string | `asc`, `desc` |
| `page` | integer | Page number |
| `page_size` | integer | Maximum 100 |

### 2.4 Assign claim

```http
POST /v1/claims/{claim_id}/assignment
```

**Request**

```json
{
  "assignee_id": "usr_01H...",
  "assignment_reason": "high_risk_review",
  "notes": "Assigned for duplicate-cover review."
}
```

### 2.5 Add claim note

```http
POST /v1/claims/{claim_id}/notes
```

**Request**

```json
{
  "note_type": "investigator_note",
  "content": "Call-back completed. Claimant confirmed relationship and banking details.",
  "evidence_ids": ["evd_01H..."],
  "visibility": "internal"
}
```

### 2.6 Add claim document

```http
POST /v1/claims/{claim_id}/documents
```

**Request**

```json
{
  "document_type": "certified_id",
  "storage_reference": "s3://nahashield-docs/doc_02H...",
  "sha256_hash": "sha256:...",
  "uploaded_by": "usr_01H..."
}
```

### 2.7 Run claim checks

```http
POST /v1/claims/{claim_id}/checks
```

Runs identity, death, duplicate, fraud, document, and clock checks.

**Request**

```json
{
  "checks": [
    "identity",
    "death",
    "beneficiary",
    "duplicate",
    "fraud",
    "documents",
    "clock"
  ]
}
```

**Response**

```json
{
  "claim_id": "clm_01H...",
  "checks": [
    {
      "check_type": "identity",
      "status": "passed",
      "result": "matched"
    },
    {
      "check_type": "duplicate",
      "status": "failed",
      "result": "duplicate_claim_detected",
      "duplicate_signal_id": "dup_01H..."
    }
  ]
}
```

### 2.8 Claim decision

```http
POST /v1/claims/{claim_id}/decision
```

**Request**

```json
{
  "decision": "approve",
  "amount_approved_cents": 7500000,
  "reason_code": "valid_claim",
  "reason_text": "All required verification checks passed.",
  "evidence_ids": ["evd_01H...", "evd_02H..."],
  "approver_id": "usr_01H..."
}
```

### 2.9 Claim payment instruction

```http
POST /v1/claims/{claim_id}/payment-instruction
```

**Request**

```json
{
  "beneficiary_id": "psn_02H...",
  "amount_cents": 7500000,
  "payment_method": "eft",
  "bank_account_token": "tok_01H...",
  "approved_by": "usr_01H..."
}
```

## 3. Duplicate detection API

### 3.1 Run duplicate check

```http
POST /v1/duplicate-checks
```

**Request**

```json
{
  "claim_id": "clm_01H...",
  "check_scope": [
    "same_deceased",
    "same_claimant",
    "same_beneficiary",
    "same_bank_account",
    "same_phone",
    "same_device",
    "same_address",
    "same_agent",
    "same_provider",
    "same_document"
  ],
  "consent_id": "cns_01H..."
}
```

**Response**

```json
{
  "duplicate_check_id": "dupchk_01H...",
  "claim_id": "clm_01H...",
  "duplicate_risk_score": 88.0,
  "risk_level": "high",
  "matches": [
    {
      "match_type": "same_deceased",
      "matched_claim_id": "clm_02H...",
      "match_confidence": 0.98,
      "matched_fields": [
        "id_number_hash"
      ],
      "recommended_action": "hold_and_investigate"
    }
  ],
  "innocent_explanations": [
    "Possible duplicate policy held by the same family.",
    "Possible data-entry error."
  ],
  "human_review_required": true
}
```

### 3.2 Get duplicate check

```http
GET /v1/duplicate-checks/{duplicate_check_id}
```

### 3.3 Resolve duplicate signal

```http
POST /v1/duplicate-signals/{duplicate_signal_id}/resolution
```

**Request**

```json
{
  "resolution": "false_positive",
  "reason": "Claimant confirmed that the second policy belongs to a different family member.",
  "evidence_ids": ["evd_03H..."],
  "reviewer_id": "usr_01H..."
}
```

## 4. Evidence API

### 4.1 Add evidence

```http
POST /v1/evidence
```

**Request**

```json
{
  "claim_id": "clm_01H...",
  "evidence_type": "bank_statement",
  "source": "insurer_finance",
  "document_id": "doc_01H...",
  "description": "Bank statement confirming payment",
  "evidence_class": "verified_fact",
  "hash": "sha256:..."
}
```

### 4.2 Get evidence

```http
GET /v1/evidence/{evidence_id}
```

### 4.3 Link evidence to claim

```http
POST /v1/claims/{claim_id}/evidence-links
```

**Request**

```json
{
  "evidence_id": "evd_01H...",
  "link_type": "supports_indicator",
  "indicator_id": "ind_01H..."
}
```

### 4.4 Calculate evidence strength

```http
POST /v1/evidence/{evidence_id}/strength
```

**Response**

```json
{
  "evidence_id": "evd_01H...",
  "evidence_strength_score": 82.0,
  "source_reliability": 90.0,
  "corroboration": 75.0,
  "provenance": 85.0,
  "recency": 80.0,
  "label": "strong"
}
```

## 5. Adverse-action API

### 5.1 Create adverse action

```http
POST /v1/adverse-actions
```

**Request**

```json
{
  "claim_id": "clm_01H...",
  "action_type": "hold",
  "reason_code": "duplicate_claim_detected",
  "reason_text": "A potential duplicate claim requires review before payment.",
  "evidence_ids": ["evd_01H..."],
  "proposed_by": "usr_01H...",
  "expires_at": "2026-12-02T16:00:00Z"
}
```

### 5.2 Approve adverse action

```http
POST /v1/adverse-actions/{adverse_action_id}/approval
```

**Request**

```json
{
  "decision": "approve",
  "approver_id": "usr_01H...",
  "reason": "Duplicate signal requires human review."
}
```

### 5.3 Create appeal

```http
POST /v1/appeals
```

**Request**

```json
{
  "claim_id": "clm_01H...",
  "adverse_action_id": "adv_01H...",
  "claimant_id": "psn_02H...",
  "appeal_reason": "The second policy belongs to a different family member.",
  "supporting_document_ids": ["doc_03H..."]
}
```

### 5.4 Decide appeal

```http
POST /v1/appeals/{appeal_id}/decision
```

**Request**

```json
{
  "outcome": "overturned",
  "reviewer_id": "usr_01H...",
  "outcome_reason": "Independent evidence confirms no duplicate cover.",
  "evidence_ids": ["evd_04H..."]
}
```

## 6. Notification API

### 6.1 Send notification

```http
POST /v1/notifications
```

**Request**

```json
{
  "claim_id": "clm_01H...",
  "recipient_id": "psn_02H...",
  "channel": "sms",
  "template_id": "claim_documents_required_v1",
  "language": "en",
  "variables": {
    "claim_reference": "CLM-2026-00421",
    "document_type": "certified ID",
    "due_date": "2 December 2026"
  },
  "approved_by": "usr_01H..."
}
```

### 6.2 Get notification status

```http
GET /v1/notifications/{notification_id}
```

## 7. Database schema and indexes

### 7.1 Core tables

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

CREATE TABLE policies (
  policy_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  policy_number TEXT NOT NULL,
  insurer_id UUID NOT NULL,
  broker_id UUID,
  agent_id UUID,
  policyholder_id UUID NOT NULL,
  status TEXT NOT NULL,
  cover_amount_cents BIGINT NOT NULL,
  premium_amount_cents BIGINT NOT NULL,
  issued_at TIMESTAMPTZ,
  lapsed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE persons (
  person_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  id_number_hash TEXT NOT NULL,
  full_name_encrypted TEXT,
  date_of_birth DATE,
  phone_hash TEXT,
  email_hash TEXT,
  address_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE beneficiaries (
  beneficiary_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  policy_id UUID NOT NULL REFERENCES policies(policy_id),
  person_id UUID NOT NULL REFERENCES persons(person_id),
  relationship TEXT NOT NULL,
  share_percentage NUMERIC(5,2),
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 7.2 Claims workspace

```sql
CREATE TABLE claims (
  claim_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  policy_id UUID NOT NULL REFERENCES policies(policy_id),
  claim_number TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  status TEXT NOT NULL,
  deceased_person_id UUID NOT NULL REFERENCES persons(person_id),
  claimant_person_id UUID NOT NULL REFERENCES persons(person_id),
  agent_id UUID,
  amount_claimed_cents BIGINT NOT NULL DEFAULT 0,
  amount_approved_cents BIGINT NOT NULL DEFAULT 0,
  amount_paid_cents BIGINT NOT NULL DEFAULT 0,
  amount_reduced_cents BIGINT NOT NULL DEFAULT 0,
  amount_recovered_cents BIGINT NOT NULL DEFAULT 0,
  fraud_risk_score NUMERIC(5,2),
  duplicate_risk_score NUMERIC(5,2),
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

CREATE TABLE claim_notes (
  note_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  author_id UUID NOT NULL,
  note_type TEXT NOT NULL,
  content_encrypted TEXT NOT NULL,
  visibility TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 7.3 Duplicate detection tables

```sql
CREATE TABLE duplicate_checks (
  duplicate_check_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  check_scope JSONB NOT NULL,
  duplicate_risk_score NUMERIC(5,2),
  risk_level TEXT,
  status TEXT NOT NULL,
  consent_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE duplicate_signals (
  duplicate_signal_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  duplicate_check_id UUID NOT NULL REFERENCES duplicate_checks(duplicate_check_id),
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

### 7.4 Evidence and audit tables

```sql
CREATE TABLE evidence_items (
  evidence_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  evidence_type TEXT NOT NULL,
  source TEXT NOT NULL,
  document_id UUID,
  description TEXT,
  evidence_class TEXT NOT NULL,
  evidence_strength_score NUMERIC(5,2),
  sha256_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE evidence_links (
  evidence_link_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  evidence_id UUID NOT NULL REFERENCES evidence_items(evidence_id),
  link_type TEXT NOT NULL,
  indicator_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  event_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  actor_id UUID,
  actor_role TEXT,
  subject_type TEXT NOT NULL,
  subject_id UUID NOT NULL,
  purpose TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  previous_hash TEXT,
  event_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 7.5 Adverse-action and appeal tables

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
```

### 7.6 Indexes

```sql
-- Tenant isolation
CREATE INDEX idx_claims_tenant_status
ON claims (tenant_id, status);

CREATE INDEX idx_claims_tenant_owner
ON claims (tenant_id, owner_id);

CREATE INDEX idx_claims_tenant_clock
ON claims (tenant_id, clock_status, clock_due_at);

CREATE INDEX idx_claims_tenant_amount
ON claims (tenant_id, amount_claimed_cents DESC);

CREATE INDEX idx_claims_tenant_risk
ON claims (tenant_id, fraud_risk_score DESC);

CREATE INDEX idx_claims_tenant_submitted
ON claims (tenant_id, submitted_at DESC);

-- Duplicate detection
CREATE INDEX idx_duplicate_signals_tenant_claim
ON duplicate_signals (tenant_id, claim_id);

CREATE INDEX idx_duplicate_signals_tenant_status
ON duplicate_signals (tenant_id, status);

CREATE INDEX idx_duplicate_signals_tenant_rule
ON duplicate_signals (tenant_id, rule_id);

CREATE INDEX idx_duplicate_signals_tenant_score
ON duplicate_signals (tenant_id, match_confidence DESC);

CREATE INDEX idx_duplicate_matches_tenant_source
ON duplicate_matches (tenant_id, source_claim_id);

CREATE INDEX idx_duplicate_matches_tenant_target
ON duplicate_matches (tenant_id, target_claim_id);

CREATE INDEX idx_duplicate_matches_tenant_policy
ON duplicate_matches (tenant_id, target_policy_id);

-- Evidence
CREATE INDEX idx_evidence_tenant_claim
ON evidence_items (tenant_id, claim_id);

CREATE INDEX idx_evidence_tenant_class
ON evidence_items (tenant_id, evidence_class);

CREATE INDEX idx_evidence_tenant_strength
ON evidence_items (tenant_id, evidence_strength_score DESC);

-- Adverse actions and appeals
CREATE INDEX idx_adverse_actions_tenant_claim
ON adverse_actions (tenant_id, claim_id);

CREATE INDEX idx_adverse_actions_tenant_status
ON adverse_actions (tenant_id, status);

CREATE INDEX idx_adverse_actions_tenant_expiry
ON adverse_actions (tenant_id, expires_at)
WHERE status = 'active';

CREATE INDEX idx_appeals_tenant_claim
ON appeals (tenant_id, claim_id);

CREATE INDEX idx_appeals_tenant_status
ON appeals (tenant_id, status);

CREATE INDEX idx_appeals_tenant_submitted
ON appeals (tenant_id, submitted_at DESC);

-- Audit
CREATE INDEX idx_audit_events_tenant_subject
ON audit_events (tenant_id, subject_type, subject_id);

CREATE INDEX idx_audit_events_tenant_actor
ON audit_events (tenant_id, actor_id, created_at DESC);

CREATE INDEX idx_audit_events_tenant_event
ON audit_events (tenant_id, event_type, created_at DESC);

-- JSONB search
CREATE INDEX idx_claim_indicators_innocent
ON claim_indicators USING GIN (innocent_explanations);

CREATE INDEX idx_duplicate_signals_innocent
ON duplicate_signals USING GIN (innocent_explanations);

CREATE INDEX idx_claim_events_payload
ON claim_events USING GIN (payload);
```

PostgreSQL supports partial indexes for indexing only a useful subset of rows, and GIN indexes for searching keys or key/value pairs in JSONB documents. [postgresql](https://www.postgresql.org/docs/current/gin.html)

## 8. Client communication templates

### Communication principles

- Neutral tone.
- No accusation.
- Plain language.
- Specific action required.
- Clear deadline.
- Appeal route.
- No fraud language.
- Human approval before sending.
- Separate consent for marketing; claims-service messages are not marketing.

POPIA restricts direct marketing by SMS or email unless the required consent conditions are met; marketing messages must identify the sender and provide an opt-out route. Claims-service messages should be kept clearly separate from marketing. [dhs.gov](https://www.dhs.gov.za/sites/default/files/documents/POPIA%20FORM%2004-%20CONSENT%20OF%20A%20DATA%20SUBJECT%20FOR%20THE%20PROCESSING%20OF%20PERSONAL%20INFORMATION%20(1).pdf)

### 8.1 Claim received

**SMS**

```text
Pride Life: Your funeral claim CLM-2026-00421 has been received. We will contact you if we need more information. Reply HELP for assistance.
```

### 8.2 Documents required

**SMS**

```text
Pride Life: We need one more document to finalise claim CLM-2026-00421: a certified ID for the deceased. Please submit it by 2 December 2026. Reply HELP for assistance.
```

### 8.3 Call-back required

**SMS**

```text
Pride Life: We need to confirm a few details about claim CLM-2026-00421. Please call 011 000 0000 between 08:00 and 17:00, Monday to Friday. Reference: CLM-2026-00421.
```

### 8.4 Claim on hold

**SMS**

```text
Pride Life: Claim CLM-2026-00421 is being reviewed. We will contact you by 2 December 2026. If you have questions, reply HELP.
```

### 8.5 Claim approved

**SMS**

```text
Pride Life: Good news. Claim CLM-2026-00421 has been approved. Payment will be processed to the approved beneficiary account.
```

### 8.6 Claim declined

**SMS**

```text
Pride Life: Claim CLM-2026-00421 could not be approved. A written explanation and review options have been sent to your registered contact details.
```

### 8.7 Claim reduced

**SMS**

```text
Pride Life: Claim CLM-2026-00421 has been approved for a reduced amount. A written explanation and review options have been sent to your registered contact details.
```

### 8.8 Appeal received

**SMS**

```text
Pride Life: We have received your review request for claim CLM-2026-00421. A separate reviewer will assess it and contact you with the outcome.
```

### 8.9 Appeal outcome

**SMS**

```text
Pride Life: Your review request for claim CLM-2026-00421 has been completed. A written outcome has been sent to your registered contact details.
```

### 8.10 Duplicate-cover query

**SMS**

```text
Pride Life: We need to confirm whether there is existing funeral cover for the person on claim CLM-2026-00421. Please call 011 000 0000. Reference: CLM-2026-00421.
```

## 9. Investigator frontend components

### 9.1 Investigator home

**Purpose:** Show the investigator what to work on first.

**Components**

| Component | Purpose |
|---|---|
| `InvestigatorKpiBar` | Shows open cases, high-risk cases, overdue clocks, and rands at stake |
| `CaseQueueTable` | Shows cases ranked by rands, risk, evidence strength, and clock |
| `FilterPanel` | Filters by risk, status, amount, agent, parlour, and clock |
| `QuickActionBar` | Lets investigator open case, assign, escalate, or request documents |
| `ShieldPanel` | Lets investigator ask questions about a case |

**State**

```json
{
  "filters": {
    "status": "open",
    "risk_level": "high",
    "clock_status": "due_soon",
    "min_amount_cents": 1000000
  },
  "sort": {
    "field": "amount_claimed_cents",
    "order": "desc"
  },
  "selected_claim_id": null
}
```

### 9.2 Case workspace

**Purpose:** Let the investigator make a decision without leaving the page.

**Layout**

```text
+--------------------------------------------------------------+
| Claim header: reference, status, rands, clock, owner         |
+--------------------------------------------------------------+
| Left column             | Middle column        | Right column |
| Indicators              | Timeline             | Shield panel |
| Evidence                | Relationships        | Actions      |
| Documents               | Duplicate matches    | Approvals    |
+--------------------------------------------------------------+
```

**Components**

| Component | Purpose |
|---|---|
| `ClaimHeader` | Claim reference, status, amount, clock, owner |
| `RiskSummaryCard` | Fraud score, duplicate score, evidence strength |
| `IndicatorList` | Shows each indicator, severity, evidence, and innocent explanations |
| `EvidencePanel` | Shows evidence items, class, strength, source, and hash |
| `DocumentViewer` | Shows document with redaction and verification result |
| `TimelinePanel` | Shows policy, payment, claim, and communication events |
| `RelationshipGraph` | Shows people, policies, claims, agents, accounts, and devices |
| `DuplicateMatchPanel` | Shows duplicate matches, confidence, and recommended action |
| `ShieldPanel` | Lets investigator ask questions and generate drafts |
| `DecisionPanel` | Lets investigator hold, request documents, escalate, or close |
| `ApprovalPanel` | Shows approvals required before an action is executed |

### 9.3 Indicator card

```text
+--------------------------------------------------------------+
| Duplicate claim detected                            HIGH      |
| Same deceased ID appears on another claim.                    |
|                                                              |
| Amount at stake: R75,000                                      |
| Evidence strength: Moderate                                   |
|                                                              |
| Evidence:                                                     |
| - Death certificate: Verified Fact                            |
| - Bank statement: Verified Fact                               |
| - Cross-claim match: Inference                                |
|                                                              |
| Innocent explanations:                                        |
| - Possible duplicate policy held by the same family.          |
| - Possible data-entry error.                                  |
|                                                              |
| Next step: Hold and investigate                               |
+--------------------------------------------------------------+
```

### 9.4 Shield panel

```text
+--------------------------------------------------------------+
| Ask Shield                                                   |
|                                                              |
| Why is this claim flagged?                                    |
|                                                              |
| Bottom line:                                                  |
| A potential duplicate claim is linked to the same deceased    |
| person. R75,000 is at stake.                                  |
|                                                              |
| Why:                                                          |
| - Same ID number appears on another claim.                    |
| - Same bank account appears on an earlier claim.              |
| - Claim was submitted within 48 hours of policy issue.        |
|                                                              |
| Evidence:                                                     |
| - Cross-claim match: Inference                                |
| - Bank statement: Verified Fact                               |
|                                                              |
| Innocent explanations:                                        |
| - Shared family account.                                      |
| - Data-entry error.                                           |
|                                                              |
| Next step:                                                    |
| [Hold] [Request call-back] [Escalate] [Open case]             |
+--------------------------------------------------------------+
```

### 9.5 Decision panel

```text
+--------------------------------------------------------------+
| Decision required                                             |
|                                                              |
| Recommended action: Hold and investigate                      |
| Reason: Duplicate claim detected                              |
| Evidence strength: Moderate                                   |
|                                                              |
| [Hold claim] [Request documents] [Request call-back]          |
| [Escalate] [Close as legitimate]                              |
|                                                              |
| Approval required: Claims manager                             |
+--------------------------------------------------------------+
```

## 10. Cross-claim matching test payloads

### 10.1 Exact deceased match

```json
{
  "request_id": "req_dup_001",
  "tenant_id": "ten_01H...",
  "claim_id": "clm_01H...",
  "check_scope": [
    "same_deceased",
    "same_claimant",
    "same_beneficiary",
    "same_bank_account"
  ],
  "insured_person": {
    "person_id": "psn_01H...",
    "id_number_hash": "sha256:abc123",
    "full_name": "John Mokoena",
    "date_of_birth": "1975-04-12"
  },
  "claimant": {
    "person_id": "psn_02H...",
    "id_number_hash": "sha256:def456",
    "full_name": "Mary Mokoena"
  },
  "beneficiaries": [
    {
      "person_id": "psn_02H...",
      "relationship": "spouse"
    }
  ],
  "bank_account_token": "tok_bank_001",
  "consent_id": "cns_01H..."
}
```

**Expected response**

```json
{
  "request_id": "req_dup_001",
  "duplicate_check_id": "dupchk_001",
  "duplicate_risk_score": 95.0,
  "risk_level": "high",
  "matches": [
    {
      "match_type": "same_deceased",
      "matched_claim_id": "clm_02H...",
      "match_confidence": 0.99,
      "matched_fields": [
        "id_number_hash"
      ],
      "recommended_action": "hold_and_investigate"
    }
  ],
  "human_review_required": true
}
```

### 10.2 Same bank account across claims

```json
{
  "request_id": "req_dup_002",
  "tenant_id": "ten_01H...",
  "claim_id": "clm_03H...",
  "check_scope": [
    "same_bank_account",
    "same_claimant",
    "same_device"
  ],
  "claimant": {
    "person_id": "psn_03H...",
    "id_number_hash": "sha256:ghi789"
  },
  "bank_account_token": "tok_bank_002",
  "device_fingerprint": "dev_001",
  "consent_id": "cns_02H..."
}
```

**Expected response**

```json
{
  "request_id": "req_dup_002",
  "duplicate_check_id": "dupchk_002",
  "duplicate_risk_score": 88.0,
  "risk_level": "high",
  "matches": [
    {
      "match_type": "same_bank_account",
      "matched_claim_id": "clm_04H...",
      "match_confidence": 0.94,
      "matched_fields": [
        "bank_account_token"
      ],
      "recommended_action": "hold_and_investigate"
    }
  ],
  "human_review_required": true
}
```

### 10.3 Same agent across duplicate policies

```json
{
  "request_id": "req_dup_003",
  "tenant_id": "ten_01H...",
  "claim_id": "clm_05H...",
  "check_scope": [
    "same_agent",
    "same_deceased",
    "same_provider"
  ],
  "agent_id": "agt_01H...",
  "insured_person": {
    "person_id": "psn_04H...",
    "id_number_hash": "sha256:jkl012"
  },
  "funeral_parlour_id": "par_01H...",
  "consent_id": "cns_03H..."
}
```

**Expected response**

```json
{
  "request_id": "req_dup_003",
  "duplicate_check_id": "dupchk_003",
  "duplicate_risk_score": 82.0,
  "risk_level": "high",
  "matches": [
    {
      "match_type": "same_agent",
      "matched_policy_id": "pol_02H...",
      "match_confidence": 0.91,
      "matched_fields": [
        "agent_id"
      ],
      "recommended_action": "agent_review"
    }
  ],
  "human_review_required": true
}
```

### 10.4 Innocent shared household address

```json
{
  "request_id": "req_dup_004",
  "tenant_id": "ten_01H...",
  "claim_id": "clm_06H...",
  "check_scope": [
    "same_address",
    "same_claimant"
  ],
  "claimant": {
    "person_id": "psn_05H...",
    "id_number_hash": "sha256:mno345"
  },
  "address_hash": "sha256:addr_001",
  "consent_id": "cns_04H..."
}
```

**Expected response**

```json
{
  "request_id": "req_dup_004",
  "duplicate_check_id": "dupchk_004",
  "duplicate_risk_score": 35.0,
  "risk_level": "low",
  "matches": [
    {
      "match_type": "same_address",
      "matched_claim_id": "clm_07H...",
      "match_confidence": 0.65,
      "matched_fields": [
        "address_hash"
      ],
      "recommended_action": "monitor_only"
    }
  ],
  "innocent_explanations": [
    "Shared household address.",
    "Family members may live at the same address."
  ],
  "human_review_required": false
}
```

### 10.5 Same document hash

```json
{
  "request_id": "req_dup_005",
  "tenant_id": "ten_01H...",
  "claim_id": "clm_08H...",
  "check_scope": [
    "same_document"
  ],
  "document": {
    "document_id": "doc_04H...",
    "sha256_hash": "sha256:doc_hash_001",
    "perceptual_hash": "phash:doc_hash_001"
  },
  "consent_id": "cns_05H..."
}
```

**Expected response**

```json
{
  "request_id": "req_dup_005",
  "duplicate_check_id": "dupchk_005",
  "duplicate_risk_score": 90.0,
  "risk_level": "high",
  "matches": [
    {
      "match_type": "same_document_hash",
      "matched_claim_id": "clm_09H...",
      "match_confidence": 0.97,
      "matched_fields": [
        "sha256_hash"
      ],
      "recommended_action": "hold_and_investigate"
    }
  ],
  "human_review_required": true
}
```

### 10.6 Cross-insurer duplicate claim

```json
{
  "request_id": "req_dup_006",
  "tenant_id": "ten_01H...",
  "claim_id": "clm_10H...",
  "check_scope": [
    "same_deceased",
    "cross_insurer"
  ],
  "insured_person": {
    "person_id": "psn_06H...",
    "id_number_hash": "sha256:pqr678"
  },
  "consent_id": "cns_06H...",
  "data_sharing_scope": "duplicate_claim_detection"
}
```

**Expected response**

```json
{
  "request_id": "req_dup_006",
  "duplicate_check_id": "dupchk_006",
  "duplicate_risk_score": 97.0,
  "risk_level": "high",
  "matches": [
    {
      "match_type": "cross_insurer_duplicate_claim",
      "matched_insurer": "insurer_b",
      "matched_claim_reference": "masked",
      "match_confidence": 0.99,
      "matched_fields": [
        "id_number_hash"
      ],
      "recommended_action": "cross_market_referral"
    }
  ],
  "human_review_required": true
}
```

## 11. Test assertions

For every test payload, assert:

- Correct duplicate risk score.
- Correct risk level.
- Correct match type.
- Correct matched entity.
- Correct recommended action.
- Correct innocent explanations.
- Correct human-review requirement.
- Correct tenant isolation.
- Correct audit event.
- No automatic adverse action.
- No accusation wording.
- Correct appeal availability.

## 12. Sources

- REST API implementation best practices: idempotency, pagination, filtering, and consistent error handling. [learn.microsoft](https://learn.microsoft.com/en-ca/azure/architecture/best-practices/api-implementation)
- PostgreSQL indexing: partial indexes and GIN indexes for JSONB search. [postgresql](https://www.postgresql.org/docs/current/gin.html)
- POPIA direct-marketing consent and sender-identification requirements for electronic communications. [dhs.gov](https://www.dhs.gov.za/sites/default/files/documents/POPIA%20FORM%2004-%20CONSENT%20OF%20A%20DATA%20SUBJECT%20FOR%20THE%20PROCESSING%20OF%20PERSONAL%20INFORMATION%20(1).pdf)
- NahaShield prior specifications: adverse-action workflow, model governance, duplicate detection, pilot design, and role-based access control.
