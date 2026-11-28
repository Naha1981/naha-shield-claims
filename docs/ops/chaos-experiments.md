# Chaos experiments (reference, staging/local only, free tools)

> Saved from Thabiso's spec 5. Principles apply: never against production without
> explicit approval, limit blast radius, automatic rollback. For ClaimTrace these
> would only ever run against a local or staging environment.


### 3.1 Chaos principles

- Start in staging.
- Define a steady-state hypothesis.
- Limit blast radius.
- Run during business hours with an on-call engineer.
- Automatically roll back if customer impact occurs.
- Never run against production without explicit approval.

### 3.2 Experiment catalogue

| Experiment | Hypothesis | Blast radius | Expected outcome | Rollback |
|---|---|---|---|---|
| Duplicate-check API latency | p95 remains below 1.5 seconds with 100 ms injected latency | One pod | Requests queue, no claim loss | Remove latency |
| Database connection failure | API degrades gracefully and retries | One database connection pool | No data loss, alerts fire | Restore connection |
| Kafka consumer lag | Queue grows but does not lose events | One consumer group | Messages processed after recovery | Restart consumer |
| Graph database outage | Duplicate matching falls back to exact matching | One graph node | Exact checks continue | Restore graph |
| Pod crash | Traffic redistributes without downtime | One pod | No 5xx spike above threshold | Kubernetes restarts pod |
| Redis cache failure | API remains available with higher latency | Cache only | No claim loss | Restore cache |
| Home Affairs timeout | Verification retries and queues | One integration | No claim payment without verification | Restore integration |
| Insurer API failure | ClaimTrace degrades gracefully | One insurer connector | No data loss | Restore connector |
| Network partition | Service remains isolated and fails safely | One availability zone | No cross-tenant leakage | Restore network |
| High CPU | Queue grows but no event loss | Duplicate-matching service | Alerts fire, autoscaling activates | Reduce load |

### 3.3 Experiment: duplicate-check latency

**Steady-state hypothesis**

With 100 VUs, duplicate-check p95 latency remains below 1.5 seconds and error rate remains below 1%.

**Fault**

Inject 100 ms latency into the duplicate-check service.

**Expected result**

- p95 latency increases but remains below 1.5 seconds.
- Error rate remains below 1%.
- Queue depth increases temporarily.
- No claim is lost.
- Alerts fire at 70% of threshold.

**Rollback**

Remove latency injection.

### 3.4 Experiment: Kafka consumer failure

**Steady-state hypothesis**

A duplicate-matching consumer can restart without losing events.

**Fault**

Kill one consumer pod.

**Expected result**

- Kubernetes restarts the pod.
- Queue lag rises temporarily.
- No duplicate-check event is lost.
- Consumer catches up within five minutes.

**Rollback**

Restart consumer group.

### 3.5 Experiment: graph database outage

**Steady-state hypothesis**

Duplicate matching continues using exact-match indexes when the graph database is unavailable.

**Fault**

Block network access to Neo4j.

**Expected result**

- Exact-match checks continue.
- Graph-based checks are queued.
- No cross-tenant data exposure.
- Alerts fire.

**Rollback**

Restore network access.

