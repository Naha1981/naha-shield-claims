Below is the complete **cross-claim matching test-case suite** for NahaShield. It covers exact, fuzzy, graph, behavioural, cross-insurer, privacy, performance, and fairness tests. The suite is designed to prove that the engine catches real duplicate risk without creating excessive false positives or unfair adverse actions.

## 1. Test objectives

| Objective | Success measure |
|---|---|
| Detect duplicate claims | Correctly identify known duplicate claims |
| Detect duplicate policies | Correctly identify known duplicate policies |
| Prevent false positives | Do not flag legitimate claims as duplicates |
| Prevent unfair adverse action | No automatic hold, decline, or referral from a single weak signal |
| Protect privacy | No plaintext ID, bank, phone, address, or biometric data in logs |
| Enforce tenant isolation | No cross-tenant data leakage |
| Support human review | Every uncertain case routes to review |
| Produce explainable output | Every match shows evidence, confidence, and innocent explanations |

## 2. Test data model

Each test case should use synthetic data with:

- `tenant_id`
- `claim_id`
- `policy_id`
- `insured_person`
- `claimant`
- `beneficiaries`
- `bank_account_token`
- `phone_hash`
- `device_fingerprint`
- `address_hash`
- `agent_id`
- `funeral_parlour_id`
- `doctor_id`
- `document_hash`
- `perceptual_hash`
- `consent_id`
- `expected_match_type`
- `expected_risk_level`
- `expected_action`
- `expected_human_review`

## 3. Test categories

| Category | Purpose |
|---|---|
| Exact matching | Confirm high-confidence duplicate detection |
| Fuzzy matching | Detect near matches without over-flagging |
| Graph matching | Detect networks and shared links |
| Behavioural matching | Detect suspicious timing and patterns |
| Cross-insurer matching | Detect duplicates across participating insurers |
| Innocent controls | Ensure legitimate patterns are not flagged |
| Negative testing | Ensure invalid or missing data is handled safely |
| Boundary testing | Test thresholds and edge cases |
| Privacy testing | Ensure no sensitive data leaks |
| Fairness testing | Ensure no group is disproportionately flagged |
| Performance testing | Ensure acceptable latency and throughput |

Equivalence partitioning and boundary-value analysis are appropriate here because the engine must behave consistently within classes of inputs and correctly at thresholds. [idc-online](https://www.idc-online.com/technical_references/pdfs/information_technology/Boundary_Value_Analysis_and_Equivalence_Class_Partitioning.pdf)

## 4. Exact-match test cases

### TC-DUP-001: Same deceased ID, two claims

**Scenario:** The same deceased person appears on two claims.

**Input**

```json
{
  "claim_id": "clm_001",
  "insured_person": {
    "id_number_hash": "hash_deceased_001"
  },
  "related_claim": {
    "claim_id": "clm_002",
    "insured_person": {
      "id_number_hash": "hash_deceased_001"
    }
  }
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `same_deceased` |
| Match confidence | 0.99 |
| Risk level | High |
| Duplicate risk score | 95 |
| Recommended action | `hold_and_investigate` |
| Human review | Required |
| Innocent explanation | “Possible duplicate policy held by the same family.” |

### TC-DUP-002: Same deceased ID, two policies

**Scenario:** The same deceased person is covered under two policies.

**Input**

```json
{
  "claim_id": "clm_003",
  "insured_person": {
    "id_number_hash": "hash_deceased_002"
  },
  "related_policy": {
    "policy_id": "pol_002",
    "insured_person": {
      "id_number_hash": "hash_deceased_002"
    }
  }
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `same_deceased_policy` |
| Match confidence | 0.98 |
| Risk level | High |
| Duplicate risk score | 90 |
| Recommended action | `hold_and_investigate` |
| Human review | Required |

### TC-DUP-003: Same claimant, two unrelated claims

**Scenario:** The same claimant appears on claims for unrelated deceased people.

**Input**

```json
{
  "claim_id": "clm_004",
  "claimant": {
    "id_number_hash": "hash_claimant_001"
  },
  "related_claim": {
    "claim_id": "clm_005",
    "claimant": {
      "id_number_hash": "hash_claimant_001"
    },
    "deceased": {
      "id_number_hash": "hash_deceased_003"
    }
  }
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `same_claimant_multiple_claims` |
| Match confidence | 0.95 |
| Risk level | High |
| Duplicate risk score | 80 |
| Recommended action | `investigate` |
| Human review | Required |

### TC-DUP-004: Same beneficiary, two unrelated claims

**Scenario:** The same beneficiary appears on claims for unrelated deceased people.

**Input**

```json
{
  "claim_id": "clm_006",
  "beneficiary": {
    "id_number_hash": "hash_beneficiary_001"
  },
  "related_claim": {
    "claim_id": "clm_007",
    "beneficiary": {
      "id_number_hash": "hash_beneficiary_001"
    },
    "deceased": {
      "id_number_hash": "hash_deceased_004"
    }
  }
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `same_beneficiary_multiple_claims` |
| Match confidence | 0.94 |
| Risk level | High |
| Duplicate risk score | 78 |
| Recommended action | `investigate` |
| Human review | Required |

### TC-DUP-005: Same bank account, multiple payouts

**Scenario:** One bank account receives payouts for unrelated deceased people.

**Input**

```json
{
  "claim_id": "clm_008",
  "bank_account_token": "tok_bank_001",
  "related_claim": {
    "claim_id": "clm_009",
    "bank_account_token": "tok_bank_001",
    "deceased": {
      "id_number_hash": "hash_deceased_005"
    }
  }
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `same_bank_account_multiple_claims` |
| Match confidence | 0.97 |
| Risk level | High |
| Duplicate risk score | 92 |
| Recommended action | `hold_and_investigate` |
| Human review | Required |

## 5. Fuzzy-match test cases

### TC-DUP-006: Similar name, same date of birth

**Scenario:** Names differ slightly, but ID hash and date of birth match.

**Input**

```json
{
  "claim_id": "clm_010",
  "insured_person": {
    "full_name": "John Mokoena",
    "date_of_birth": "1975-04-12",
    "id_number_hash": "hash_deceased_006"
  },
  "related_claim": {
    "insured_person": {
      "full_name": "Jon Mokoena",
      "date_of_birth": "1975-04-12",
      "id_number_hash": "hash_deceased_006"
    }
  }
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `fuzzy_name_exact_id` |
| Match confidence | 0.96 |
| Risk level | High |
| Duplicate risk score | 88 |
| Recommended action | `hold_and_investigate` |
| Human review | Required |

### TC-DUP-007: Similar name, different ID number

**Scenario:** Names are similar, but ID hashes differ.

**Input**

```json
{
  "claim_id": "clm_011",
  "insured_person": {
    "full_name": "Sipho Dlamini",
    "id_number_hash": "hash_deceased_007"
  },
  "related_claim": {
    "insured_person": {
      "full_name": "Sipho Dlamini",
      "id_number_hash": "hash_deceased_008"
    }
  }
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `similar_name_different_id` |
| Match confidence | 0.35 |
| Risk level | Low |
| Duplicate risk score | 25 |
| Recommended action | `monitor_only` |
| Human review | Not required |
| Innocent explanation | “Different people may share the same name.” |

### TC-DUP-008: Same surname, different person

**Scenario:** Same surname but different ID, date of birth, and address.

**Input**

```json
{
  "claim_id": "clm_012",
  "insured_person": {
    "full_name": "Thabo Nkosi",
    "id_number_hash": "hash_deceased_009"
  },
  "related_claim": {
    "insured_person": {
      "full_name": "Sipho Nkosi",
      "id_number_hash": "hash_deceased_010"
    }
  }
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `same_surname_only` |
| Match confidence | 0.20 |
| Risk level | Low |
| Duplicate risk score | 10 |
| Recommended action | `no_action` |
| Human review | Not required |

### TC-DUP-009: Transposed ID digits

**Scenario:** ID number contains a likely transposition error.

**Input**

```json
{
  "claim_id": "clm_013",
  "insured_person": {
    "id_number_hash": "hash_deceased_011"
  },
  "related_claim": {
    "insured_person": {
      "id_number_hash": "hash_deceased_012"
    }
  },
  "metadata": {
    "id_transposition_detected": true
  }
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `possible_id_transposition` |
| Match confidence | 0.70 |
| Risk level | Medium |
| Duplicate risk score | 60 |
| Recommended action | `request_verification` |
| Human review | Required |

### TC-DUP-010: Same phone number, different claimants

**Scenario:** Same phone number appears on unrelated claims.

**Input**

```json
{
  "claim_id": "clm_014",
  "claimant": {
    "phone_hash": "hash_phone_001"
  },
  "related_claim": {
    "claimant": {
      "phone_hash": "hash_phone_001"
    },
    "deceased": {
      "id_number_hash": "hash_deceased_013"
    }
  }
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `same_phone_multiple_claims` |
| Match confidence | 0.80 |
| Risk level | Medium |
| Duplicate risk score | 65 |
| Recommended action | `request_call_back` |
| Human review | Required |
| Innocent explanation | “Family members may share a phone number.” |

## 6. Graph-match test cases

### TC-DUP-011: Shared agent across duplicate policies

**Scenario:** One agent sold policies for the same deceased person.

**Input**

```json
{
  "claim_id": "clm_015",
  "agent_id": "agt_001",
  "insured_person": {
    "id_number_hash": "hash_deceased_014"
  },
  "related_policy": {
    "policy_id": "pol_003",
    "agent_id": "agt_001",
    "insured_person": {
      "id_number_hash": "hash_deceased_014"
    }
  }
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `same_agent_duplicate_policy` |
| Match confidence | 0.93 |
| Risk level | High |
| Duplicate risk score | 85 |
| Recommended action | `agent_review` |
| Human review | Required |

### TC-DUP-012: Shared funeral parlour across suspicious claims

**Scenario:** One funeral parlour appears on multiple suspicious claims.

**Input**

```json
{
  "claim_id": "clm_016",
  "funeral_parlour_id": "par_001",
  "related_claim": {
    "claim_id": "clm_017",
    "funeral_parlour_id": "par_001",
    "status": "flagged"
  }
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `shared_funeral_parlour` |
| Match confidence | 0.72 |
| Risk level | Medium |
| Duplicate risk score | 60 |
| Recommended action | `provider_review` |
| Human review | Required |
| Innocent explanation | “Busy parlour may naturally process many claims.” |

### TC-DUP-013: Shared doctor across suspicious claims

**Scenario:** One doctor certifies multiple suspicious claims.

**Input**

```json
{
  "claim_id": "clm_018",
  "doctor_id": "doc_001",
  "related_claim": {
    "claim_id": "clm_019",
    "doctor_id": "doc_001",
    "status": "flagged"
  }
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `shared_certifying_doctor` |
| Match confidence | 0.70 |
| Risk level | Medium |
| Duplicate risk score | 58 |
| Recommended action | `provider_review` |
| Human review | Required |

### TC-DUP-014: Shared device across unrelated claims

**Scenario:** Same device fingerprint appears on unrelated claims.

**Input**

```json
{
  "claim_id": "clm_020",
  "device_fingerprint": "dev_001",
  "related_claim": {
    "claim_id": "clm_021",
    "device_fingerprint": "dev_001",
    "deceased": {
      "id_number_hash": "hash_deceased_015"
    }
  }
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `same_device_multiple_claims` |
| Match confidence | 0.78 |
| Risk level | Medium |
| Duplicate risk score | 65 |
| Recommended action | `request_call_back` |
| Human review | Required |
| Innocent explanation | “Shared household device.” |

### TC-DUP-015: Shared address across unrelated claims

**Scenario:** Same address appears on unrelated claims.

**Input**

```json
{
  "claim_id": "clm_022",
  "address_hash": "hash_address_001",
  "related_claim": {
    "claim_id": "clm_023",
    "address_hash": "hash_address_001",
    "deceased": {
      "id_number_hash": "hash_deceased_016"
    }
  }
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `same_address_multiple_claims` |
| Match confidence | 0.65 |
| Risk level | Medium |
| Duplicate risk score | 50 |
| Recommended action | `monitor_only` |
| Human review | Required |
| Innocent explanation | “Shared household address.” |

## 7. Behavioural test cases

### TC-DUP-016: Claim within 48 hours of policy issue

**Scenario:** Claim submitted within 48 hours of policy issue.

**Input**

```json
{
  "claim_id": "clm_024",
  "policy_issued_at": "2026-11-26T08:00:00Z",
  "claim_submitted_at": "2026-11-27T07:00:00Z"
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `early_claim_after_issue` |
| Match confidence | 0.85 |
| Risk level | High |
| Duplicate risk score | 78 |
| Recommended action | `investigate` |
| Human review | Required |

### TC-DUP-017: Claim within seven days of cover increase

**Scenario:** Cover increased shortly before claim.

**Input**

```json
{
  "claim_id": "clm_025",
  "cover_increase_at": "2026-11-20T08:00:00Z",
  "claim_submitted_at": "2026-11-25T07:00:00Z"
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `claim_after_cover_increase` |
| Match confidence | 0.88 |
| Risk level | High |
| Duplicate risk score | 82 |
| Recommended action | `investigate` |
| Human review | Required |

### TC-DUP-018: Same document hash across claims

**Scenario:** Identical document hash appears on multiple claims.

**Input**

```json
{
  "claim_id": "clm_026",
  "document": {
    "sha256_hash": "hash_doc_001"
  },
  "related_claim": {
    "claim_id": "clm_027",
    "document": {
      "sha256_hash": "hash_doc_001"
    }
  }
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `same_document_hash` |
| Match confidence | 0.97 |
| Risk level | High |
| Duplicate risk score | 90 |
| Recommended action | `hold_and_investigate` |
| Human review | Required |

### TC-DUP-019: Same perceptual hash across claims

**Scenario:** Different file, but visually similar document.

**Input**

```json
{
  "claim_id": "clm_028",
  "document": {
    "perceptual_hash": "phash_doc_001"
  },
  "related_claim": {
    "claim_id": "clm_029",
    "document": {
      "perceptual_hash": "phash_doc_001"
    }
  }
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `same_document_perceptual_hash` |
| Match confidence | 0.88 |
| Risk level | High |
| Duplicate risk score | 82 |
| Recommended action | `hold_and_investigate` |
| Human review | Required |

### TC-DUP-020: Repeated claim pattern across insurers

**Scenario:** Similar claim pattern appears across multiple insurers.

**Input**

```json
{
  "claim_id": "clm_030",
  "insured_person": {
    "id_number_hash": "hash_deceased_017"
  },
  "cross_insurer_signals": [
    {
      "insurer": "insurer_b",
      "claim_pattern": "duplicate_claim",
      "match_confidence": 0.96
    }
  ]
}
```

**Expected result**

| Field | Expected |
|---|---|
| Match type | `cross_insurer_duplicate_claim` |
| Match confidence | 0.96 |
| Risk level | High |
| Duplicate risk score | 95 |
| Recommended action | `cross_market_referral` |
| Human review | Required |

## 8. Innocent-control test cases

### TC-DUP-021: Same surname, different person

**Scenario:** Same surname but no other link.

**Expected result**

| Field | Expected |
|---|---|
| Match type | `same_surname_only` |
| Risk level | Low |
| Duplicate risk score | 10 |
| Recommended action | `no_action` |
| Human review | Not required |

### TC-DUP-022: Same household address

**Scenario:** Family members live at the same address.

**Expected result**

| Field | Expected |
|---|---|
| Match type | `same_household_address` |
| Risk level | Low |
| Duplicate risk score | 30 |
| Recommended action | `monitor_only` |
| Human review | Required |
| Innocent explanation | “Family members may live at the same address.” |

### TC-DUP-023: Shared family phone

**Scenario:** Family members share a phone number.

**Expected result**

| Field | Expected |
|---|---|
| Match type | `shared_family_phone` |
| Risk level | Low |
| Duplicate risk score | 35 |
| Recommended action | `monitor_only` |
| Human review | Required |

### TC-DUP-024: Shared family bank account

**Scenario:** Family members share a bank account.

**Expected result**

| Field | Expected |
|---|---|
| Match type | `shared_family_bank_account` |
| Risk level | Medium |
| Duplicate risk score | 55 |
| Recommended action | `request_call_back` |
| Human review | Required |

### TC-DUP-025: Same funeral parlour, high volume

**Scenario:** Busy parlour processes many legitimate claims.

**Expected result**

| Field | Expected |
|---|---|
| Match type | `high_volume_parlour` |
| Risk level | Low |
| Duplicate risk score | 20 |
| Recommended action | `monitor_only` |
| Human review | Not required |
| Innocent explanation | “High-volume parlour may process many legitimate claims.” |

### TC-DUP-026: Same agent, high-volume legitimate book

**Scenario:** Productive agent has a large legitimate book.

**Expected result**

| Field | Expected |
|---|---|
| Match type | `high_volume_agent` |
| Risk level | Low |
| Duplicate risk score | 25 |
| Recommended action | `monitor_only` |
| Human review | Not required |

## 9. Negative test cases

### TC-DUP-027: Missing insured person

**Scenario:** Insured person is missing.

**Expected result**

| Field | Expected |
|---|---|
| API status | 400 |
| Error code | `VALIDATION_ERROR` |
| Error field | `insured_person` |
| Duplicate check | Not run |
| Audit event | Logged |

### TC-DUP-028: Missing consent

**Scenario:** No consent for duplicate check.

**Expected result**

| Field | Expected |
|---|---|
| API status | 403 |
| Error code | `CONSENT_REQUIRED` |
| Duplicate check | Not run |
| Audit event | Logged |

### TC-DUP-029: Invalid ID hash

**Scenario:** ID hash is malformed.

**Expected result**

| Field | Expected |
|---|---|
| API status | 400 |
| Error code | `INVALID_IDENTIFIER` |
| Duplicate check | Not run |
| Audit event | Logged |

### TC-DUP-030: Cross-tenant claim ID

**Scenario:** User requests a claim from another tenant.

**Expected result**

| Field | Expected |
|---|---|
| API status | 403 |
| Error code | `TENANT_ACCESS_DENIED` |
| Duplicate check | Not run |
| Audit event | Logged |
| Data leakage | None |

### TC-DUP-031: Duplicate check already running

**Scenario:** Same duplicate check submitted twice.

**Expected result**

| Field | Expected |
|---|---|
| API status | 202 |
| Behaviour | Idempotent |
| Duplicate jobs | One |
| Audit event | Logged |

## 10. Boundary test cases

### TC-DUP-032: Duplicate threshold at 70

**Scenario:** Match score is exactly 70.

**Expected result**

| Field | Expected |
|---|---|
| Risk level | Medium |
| Recommended action | `request_call_back` |
| Human review | Required |

### TC-DUP-033: Duplicate threshold just below 70

**Scenario:** Match score is 69.9.

**Expected result**

| Field | Expected |
|---|---|
| Risk level | Low |
| Recommended action | `monitor_only` |
| Human review | Not required |

### TC-DUP-034: Duplicate threshold at 85

**Scenario:** Match score is exactly 85.

**Expected result**

| Field | Expected |
|---|---|
| Risk level | High |
| Recommended action | `hold_and_investigate` |
| Human review | Required |

### TC-DUP-035: Duplicate threshold just below 85

**Scenario:** Match score is 84.9.

**Expected result**

| Field | Expected |
|---|---|
| Risk level | Medium |
| Recommended action | `request_call_back` |
| Human review | Required |

### TC-DUP-036: Zero matches

**Scenario:** No duplicate signals found.

**Expected result**

| Field | Expected |
|---|---|
| Duplicate risk score | 0 |
| Risk level | Low |
| Recommended action | `no_action` |
| Human review | Not required |

### TC-DUP-037: Maximum matches

**Scenario:** More than 20 matches found.

**Expected result**

| Field | Expected |
|---|---|
| Duplicate risk score | 100 |
| Risk level | High |
| Recommended action | `hold_and_investigate` |
| Human review | Required |
| Pagination | Required |

## 11. Privacy test cases

### TC-DUP-038: No plaintext ID in logs

**Scenario:** Duplicate check runs with ID number.

**Expected result**

| Field | Expected |
|---|---|
| Log content | No plaintext ID |
| Log content | Hashed identifier only |
| Audit event | Logged |
| Data leakage | None |

### TC-DUP-039: No plaintext bank account in logs

**Scenario:** Duplicate check runs with bank account token.

**Expected result**

| Field | Expected |
|---|---|
| Log content | No plaintext bank account |
| Log content | Tokenised identifier only |
| Audit event | Logged |

### TC-DUP-040: No cross-tenant data exposure

**Scenario:** User from tenant A requests tenant B claim.

**Expected result**

| Field | Expected |
|---|---|
| API status | 403 |
| Data leakage | None |
| Audit event | Logged |

### TC-DUP-041: Consent withdrawn

**Scenario:** Consent withdrawn before duplicate check.

**Expected result**

| Field | Expected |
|---|---|
| API status | 403 |
| Error code | `CONSENT_WITHDRAWN` |
| Duplicate check | Not run |
| Audit event | Logged |

## 12. Fairness test cases

### TC-DUP-042: Rural address control

**Scenario:** Rural address with no other duplicate signal.

**Expected result**

| Field | Expected |
|---|---|
| Risk level | Low |
| Recommended action | `no_action` |
| Human review | Not required |

### TC-DUP-043: Informal settlement address control

**Scenario:** Informal settlement address with no other duplicate signal.

**Expected result**

| Field | Expected |
|---|---|
| Risk level | Low |
| Recommended action | `no_action` |
| Human review | Not required |

### TC-DUP-044: Shared household device control

**Scenario:** Shared household device with no other duplicate signal.

**Expected result**

| Field | Expected |
|---|---|
| Risk level | Low |
| Recommended action | `monitor_only` |
| Human review | Required |

### TC-DUP-045: Shared family phone control

**Scenario:** Shared family phone with no other duplicate signal.

**Expected result**

| Field | Expected |
|---|---|
| Risk level | Low |
| Recommended action | `monitor_only` |
| Human review | Required |

### TC-DUP-046: Language control

**Scenario:** Claimant uses isiZulu, isiXhosa, Sesotho, or Afrikaans.

**Expected result**

| Field | Expected |
|---|---|
| Duplicate detection | Same logic |
| Claimant communication | Correct language |
| Appeal rights | Available |

## 13. Performance test cases

### TC-DUP-047: Single duplicate check

**Scenario:** One duplicate check with 10 signals.

**Expected result**

| Field | Expected |
|---|---|
| Latency | Under 2 seconds |
| Status | 200 |
| Audit event | Logged |

### TC-DUP-048: Bulk duplicate check

**Scenario:** 1,000 duplicate checks.

**Expected result**

| Field | Expected |
|---|---|
| Throughput | At least 100 checks per minute |
| Error rate | Below 1% |
| Queue depth | Monitored |
| Audit events | Logged |

### TC-DUP-049: Graph query with deep links

**Scenario:** Claim linked to 50 related entities.

**Expected result**

| Field | Expected |
|---|---|
| Latency | Under 3 seconds |
| Graph depth | Configurable |
| Human review | Required |

### TC-DUP-050: Cross-insurer query timeout

**Scenario:** Cross-insurer provider times out.

**Expected result**

| Field | Expected |
|---|---|
| API status | 202 |
| Behaviour | Retry with backoff |
| Duplicate check | Queued |
| Audit event | Logged |

## 14. Test assertions

For every test case, assert:

- Correct match type.
- Correct match confidence.
- Correct duplicate risk score.
- Correct risk level.
- Correct recommended action.
- Correct innocent explanations.
- Correct human-review requirement.
- Correct tenant isolation.
- Correct audit event.
- No automatic adverse action.
- No accusation wording.
- Correct appeal availability.
- No sensitive data in logs.

## 15. Pass/fail criteria

| Metric | Pass threshold |
|---|---:|
| Precision | At least 80% |
| Recall | At least 70% |
| False-positive rate | Below insurer-agreed threshold |
| Clean-control false-positive rate | Below insurer-agreed threshold |
| Human-review rate | Monitored |
| Appeal overturn rate | Monitored |
| Latency | Under 2 seconds for single check |
| Throughput | At least 100 checks per minute |
| Privacy violations | Zero |
| Tenant-isolation violations | Zero |
| Accusation wording | Zero |

## 16. Test-data requirements

Prepare a synthetic test set with:

- 1,000 clean claims.
- 100 duplicate claims.
- 50 duplicate policies.
- 25 mule-account cases.
- 25 shared-agent cases.
- 25 shared-device cases.
- 25 shared-address cases.
- 25 innocent-control cases.
- 25 cross-insurer cases.
- 25 boundary cases.
- 25 privacy cases.
- 25 fairness cases.

## 17. Test execution

Run the suite:

- On every pull request.
- Nightly against synthetic data.
- Before every model or rule release.
- Before every insurer pilot.
- After every threshold change.
- After every integration change.

The test suite should use equivalence partitioning and boundary-value analysis to ensure that the engine behaves consistently within input classes and correctly at thresholds. [idc-online](https://www.idc-online.com/technical_references/pdfs/information_technology/Boundary_Value_Analysis_and_Equivalence_Class_Partitioning.pdf)
