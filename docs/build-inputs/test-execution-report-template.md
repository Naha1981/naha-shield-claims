# TEMPLATE - DO NOT FILL WITH SPEC EXAMPLES

> Every number in this template's example text is a PLACEHOLDER from the spec
> document, never a NahaShield result. A real report replaces every placeholder
> with measured values from an actual run, or the report is invalid.

# NahaShield Cross-Claim Matching Test Execution Report (template)

**Report ID:** TR-2026-11-28-001  
**Build:** `nahashield-api@1.2.0`  
**Environment:** Staging  
**Test date:** 28 November 2026  
**Tester:** QA Engineer  
**Approver:** Engineering Lead  

## 1. Executive summary

| Item | Result |
|---|---|
| Overall status | Pass / Fail / Conditional pass |
| Total test cases | 250 |
| Passed | 240 |
| Failed | 8 |
| Blocked | 2 |
| Not executed | 0 |
| Critical defects | 1 |
| Major defects | 3 |
| Minor defects | 4 |

## 2. Scope

| Area | Included |
|---|---|
| Exact matching | Yes |
| Fuzzy matching | Yes |
| Graph matching | Yes |
| Behavioural matching | Yes |
| Cross-insurer matching | Yes |
| Innocent controls | Yes |
| Negative testing | Yes |
| Boundary testing | Yes |
| Privacy testing | Yes |
| Fairness testing | Yes |
| Load testing | Yes |
| Performance testing | Yes |

## 3. Test environment

| Item | Value |
|---|---|
| API version | 1.2.0 |
| Database | PostgreSQL 16 |
| Graph database | Neo4j 5 |
| Queue | Kafka |
| Environment | Staging |
| Region | af-south-1 |
| Data volume | 10,000 claims |
| Duplicate claims | 500 |
| Duplicate policies | 250 |
| Innocent controls | 1,000 |

## 4. Functional results

| Test category | Total | Passed | Failed | Blocked | Pass rate |
|---|---:|---:|---:|---:|---:|
| Exact matching | 20 | 20 | 0 | 0 | 100% |
| Fuzzy matching | 40 | 38 | 2 | 0 | 95% |
| Graph matching | 30 | 30 | 0 | 0 | 100% |
| Behavioural matching | 25 | 24 | 1 | 0 | 96% |
| Cross-insurer matching | 20 | 19 | 1 | 0 | 95% |
| Innocent controls | 50 | 50 | 0 | 0 | 100% |
| Negative testing | 30 | 28 | 2 | 0 | 93% |
| Boundary testing | 25 | 25 | 0 | 0 | 100% |
| Privacy testing | 20 | 20 | 0 | 0 | 100% |
| Fairness testing | 20 | 16 | 2 | 2 | 80% |

## 5. Performance results

| Profile | VUs | Duration | p50 | p95 | p99 | Error rate | Throughput | Status |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Smoke | 5 | 2m | 180 ms | 320 ms | 480 ms | 0% | 12 req/s | Pass |
| Baseline | 25 | 10m | 220 ms | 380 ms | 560 ms | 0.1% | 24 req/s | Pass |
| Load | 100 | 20m | 310 ms | 720 ms | 1,150 ms | 0.4% | 88 req/s | Pass |
| Peak | 250 | 30m | 480 ms | 1,180 ms | 2,100 ms | 0.9% | 210 req/s | Conditional pass |
| Stress | 500 | 30m | 820 ms | 2,450 ms | 4,300 ms | 2.1% | 340 req/s | Fail |
| Soak | 100 | 4h | 260 ms | 410 ms | 620 ms | 0.2% | 48 req/s | Pass |
| Burst | 500 | 5m | 640 ms | 1,620 ms | 2,900 ms | 1.2% | 280 req/s | Conditional pass |

## 6. Duplicate-match quality

| Metric | Target | Actual | Status |
|---|---:|---:|---|
| Precision | At least 80% | 86% | Pass |
| Recall | At least 70% | 74% | Pass |
| False-positive rate | Below 5% | 3.2% | Pass |
| Clean-control false-positive rate | Below 2% | 1.1% | Pass |
| Human-review rate | Monitored | 18% | Pass |
| Appeal overturn rate | Monitored | 2% | Pass |
| Accusation wording | Zero | Zero | Pass |
| Privacy violations | Zero | Zero | Pass |
| Tenant-isolation violations | Zero | Zero | Pass |

## 7. Defects

| Defect ID | Severity | Title | Status | Owner | Fix version |
|---|---|---|---|---|---|
| DEF-001 | Critical | Cross-tenant claim exposed in duplicate response | Open | Backend | 1.2.1 |
| DEF-002 | Major | Fuzzy threshold incorrectly flags shared address | Open | Data science | 1.2.1 |
| DEF-003 | Major | Duplicate check times out at 500 VUs | Open | Platform | 1.2.1 |
| DEF-004 | Major | Innocent explanation missing for shared phone | Open | Product | 1.2.1 |
| DEF-005 | Minor | Audit event missing for duplicate resolution | Open | Backend | 1.2.2 |
| DEF-006 | Minor | Pagination returns duplicate records | Open | Backend | 1.2.2 |
| DEF-007 | Minor | SMS template exceeds character limit | Open | Product | 1.2.2 |
| DEF-008 | Minor | Evidence-strength score not shown in investigator view | Open | Frontend | 1.2.2 |

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Cross-tenant exposure | Critical | Block release until fixed |
| Fuzzy false positives | High | Retune threshold and add innocent controls |
| Duplicate-check timeout | High | Scale graph service and add queue |
| Missing innocent explanations | Medium | Add explanation templates |
| Performance degradation under stress | High | Add autoscaling and caching |

## 9. Recommendations

1. Block release until DEF-001 is fixed.
2. Retune fuzzy thresholds for shared address and shared phone.
3. Add innocent-explanation templates for all match types.
4. Add autoscaling for duplicate-check service.
5. Add p99 monitoring for duplicate-check endpoint.
6. Add nightly load regression.
7. Add fairness dashboards for rural, language, and household controls.

## 10. Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Engineering lead |  | Approve / Reject |  |
| QA lead |  | Approve / Reject |  |
| Product owner |  | Approve / Reject |  |
| Compliance officer |  | Approve / Reject |  |
| Security lead |  | Approve / Reject |  |

## 11. Appendices

- Raw k6 results.
- JUnit XML results.
- Coverage report.
- Duplicate-match quality report.
- Defect list.
- Test-data manifest.
- Environment configuration.
