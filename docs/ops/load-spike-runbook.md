# Load-spike incident runbook (reference)

> Saved from Thabiso's spec 5. Commands assume a Kubernetes deployment; adapt when
> and if NahaShield ever runs somewhere real.


### 4.1 Severity levels

| Severity | Definition | Response time |
|---|---|---:|
| S1 | Claim processing stopped or data exposure | 15 minutes |
| S2 | p95 latency above 3 seconds or error rate above 5% | 30 minutes |
| S3 | Queue lag above 10,000 messages | 1 hour |
| S4 | Performance degradation without customer impact | 4 hours |

### 4.2 Immediate actions

1. Acknowledge the alert.
2. Identify affected tenant, endpoint, and region.
3. Check error rate, p95, p99, CPU, memory, database connections, and queue lag.
4. Determine whether the spike is traffic-driven or failure-driven.
5. Enable autoscaling if CPU or memory is above 70%.
6. Scale duplicate-matching workers if queue lag is rising.
7. Enable rate limiting if a tenant is sending excessive traffic.
8. Disable non-critical background jobs if database saturation is detected.
9. Notify claims operations if claim processing is delayed.
10. Preserve logs and metrics for post-incident review.

### 4.3 Diagnostic commands

```bash
# Check pod status
kubectl get pods -n nahashield \
  -l app=nahashield-duplicate-matching

# Check pod logs
kubectl logs -n nahashield \
  -l app=nahashield-duplicate-matching \
  --tail=200

# Check HPA status
kubectl get hpa -n nahashield

# Check queue lag
kubectl exec -n nahashield deploy/kafka-cli -- \
  kafka-consumer-groups.sh \
  --bootstrap-server kafka:9092 \
  --describe \
  --group duplicate-matching-worker

# Check database connections
kubectl exec -n nahashield deploy/postgres -- \
  psql -U nahashield -c "SELECT count(*) FROM pg_stat_activity;"

# Check slow queries
kubectl exec -n nahashield deploy/postgres -- \
  psql -U nahashield -c "SELECT pid, query, state, wait_event_type FROM pg_stat_activity WHERE state = 'active';"
```

### 4.4 Escalation path

| Trigger | Escalate to |
|---|---|
| p95 above 3 seconds | Platform on-call |
| Error rate above 5% | Platform on-call and engineering lead |
| Queue lag above 10,000 | Data engineering on-call |
| Database saturation | Database on-call |
| Claim processing stopped | Claims operations and incident commander |
| Data exposure | Security on-call, compliance, legal |
| Cross-tenant leakage | Security on-call, incident commander, executive |

### 4.5 Recovery actions

| Symptom | Action |
|---|---|
| High CPU | Scale duplicate-matching deployment |
| High memory | Restart pods and investigate memory leak |
| High queue lag | Scale consumers |
| Database saturation | Enable read replica, reduce batch size, pause background jobs |
| Graph database outage | Fall back to exact matching |
| Home Affairs timeout | Queue verification requests |
| Insurer API failure | Enable circuit breaker |
| Tenant abuse | Apply tenant-specific rate limit |

### 4.6 Post-incident review

Within five business days, document:

- Timeline.
- Root cause.
- Customer impact.
- Claims affected.
- Data exposure.
- Detection time.
- Recovery time.
- Corrective actions.
- Preventive actions.
- Runbook updates.

