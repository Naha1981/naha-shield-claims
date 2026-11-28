Below are the five remaining operational artefacts for NahaShield: Grafana dashboard JSON, fuzzy-match query tuning, chaos experiments, load-spike runbook, and Terraform infrastructure configuration.

## 1. Grafana dashboard JSON

Save as `observability/grafana/nahashield-duplicate-matching.json`.

Grafana dashboards are JSON objects containing metadata, panels, template variables, and panel queries. [grafana](https://grafana.com/docs/grafana/v12.4/visualizations/dashboards/build-dashboards/view-dashboard-json-model/)

```json
{
  "annotations": {
    "list": [
      {
        "builtIn": 1,
        "datasource": {
          "type": "grafana",
          "uid": "-- Grafana --"
        },
        "enable": true,
        "hide": true,
        "iconColor": "rgba(0, 211, 255, 1)",
        "name": "Annotations & Alerts",
        "type": "dashboard"
      }
    ]
  },
  "editable": true,
  "fiscalYearStartMonth": 0,
  "graphTooltip": 1,
  "id": null,
  "links": [],
  "liveNow": false,
  "panels": [
    {
      "datasource": {
        "type": "prometheus",
        "uid": "prometheus"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": null
              },
              {
                "color": "yellow",
                "value": 1000
              },
              {
                "color": "red",
                "value": 1500
              }
            ]
          },
          "unit": "ms"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 6,
        "w": 6,
        "x": 0,
        "y": 0
      },
      "id": 1,
      "options": {
        "colorMode": "background",
        "graphMode": "area",
        "justifyMode": "auto",
        "orientation": "auto",
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "textMode": "auto"
      },
      "targets": [
        {
          "datasource": {
            "type": "prometheus",
            "uid": "prometheus"
          },
          "expr": "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{service=\"nahashield-api\", endpoint=\"duplicate_check\"}[5m])) by (le)) * 1000",
          "legendFormat": "p95 duplicate-check latency",
          "refId": "A"
        }
      ],
      "title": "Duplicate Check p95 Latency",
      "type": "stat"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "prometheus"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": null
              },
              {
                "color": "yellow",
                "value": 0.005
              },
              {
                "color": "red",
                "value": 0.01
              }
            ]
          },
          "unit": "percentunit"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 6,
        "w": 6,
        "x": 6,
        "y": 0
      },
      "id": 2,
      "options": {
        "colorMode": "background",
        "graphMode": "area",
        "justifyMode": "auto",
        "orientation": "auto",
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "textMode": "auto"
      },
      "targets": [
        {
          "datasource": {
            "type": "prometheus",
            "uid": "prometheus"
          },
          "expr": "sum(rate(http_requests_total{service=\"nahashield-api\", endpoint=\"duplicate_check\", status=~\"5..\"}[5m])) / sum(rate(http_requests_total{service=\"nahashield-api\", endpoint=\"duplicate_check\"}[5m]))",
          "legendFormat": "Duplicate-check error rate",
          "refId": "A"
        }
      ],
      "title": "Duplicate Check Error Rate",
      "type": "stat"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "prometheus"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisCenteredZero": false,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "barAlignment": 0,
            "drawStyle": "line",
            "fillOpacity": 15,
            "gradientMode": "none",
            "hideFrom": {
              "legend": false,
              "tooltip": false,
              "viz": false
            },
            "lineInterpolation": "linear",
            "lineWidth": 2,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "never",
            "spanNulls": false,
            "stacking": {
              "group": "A",
              "mode": "none"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "unit": "reqps"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 6,
        "w": 12,
        "x": 12,
        "y": 0
      },
      "id": 3,
      "options": {
        "legend": {
          "calcs": [
            "mean",
            "max"
          ],
          "displayMode": "table",
          "placement": "bottom",
          "showLegend": true
        },
        "tooltip": {
          "mode": "single",
          "sort": "none"
        }
      },
      "targets": [
        {
          "datasource": {
            "type": "prometheus",
            "uid": "prometheus"
          },
          "expr": "sum(rate(http_requests_total{service=\"nahashield-api\", endpoint=\"duplicate_check\"}[5m])) by (status)",
          "legendFormat": "{{status}}",
          "refId": "A"
        }
      ],
      "title": "Duplicate Check Throughput",
      "type": "timeseries"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "prometheus"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "drawStyle": "line",
            "fillOpacity": 10,
            "lineWidth": 2,
            "showPoints": "never"
          },
          "unit": "ms"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 8,
        "w": 12,
        "x": 0,
        "y": 6
      },
      "id": 4,
      "options": {
        "legend": {
          "calcs": [
            "mean",
            "max"
          ],
          "displayMode": "table",
          "placement": "bottom",
          "showLegend": true
        },
        "tooltip": {
          "mode": "single",
          "sort": "none"
        }
      },
      "targets": [
        {
          "datasource": {
            "type": "prometheus",
            "uid": "prometheus"
          },
          "expr": "histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket{service=\"nahashield-api\", endpoint=\"duplicate_check\"}[5m])) by (le)) * 1000",
          "legendFormat": "p50",
          "refId": "A"
        },
        {
          "datasource": {
            "type": "prometheus",
            "uid": "prometheus"
          },
          "expr": "histogram_quantile(0.90, sum(rate(http_request_duration_seconds_bucket{service=\"nahashield-api\", endpoint=\"duplicate_check\"}[5m])) by (le)) * 1000",
          "legendFormat": "p90",
          "refId": "B"
        },
        {
          "datasource": {
            "type": "prometheus",
            "uid": "prometheus"
          },
          "expr": "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{service=\"nahashield-api\", endpoint=\"duplicate_check\"}[5m])) by (le)) * 1000",
          "legendFormat": "p95",
          "refId": "C"
        },
        {
          "datasource": {
            "type": "prometheus",
            "uid": "prometheus"
          },
          "expr": "histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{service=\"nahashield-api\", endpoint=\"duplicate_check\"}[5m])) by (le)) * 1000",
          "legendFormat": "p99",
          "refId": "D"
        }
      ],
      "title": "Duplicate Check Latency Percentiles",
      "type": "timeseries"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "prometheus"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "drawStyle": "line",
            "fillOpacity": 10,
            "lineWidth": 2,
            "showPoints": "never"
          },
          "unit": "short"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 8,
        "w": 12,
        "x": 12,
        "y": 6
      },
      "id": 5,
      "options": {
        "legend": {
          "calcs": [
            "mean",
            "max"
          ],
          "displayMode": "table",
          "placement": "bottom",
          "showLegend": true
        },
        "tooltip": {
          "mode": "single",
          "sort": "none"
        }
      },
      "targets": [
        {
          "datasource": {
            "type": "prometheus",
            "uid": "prometheus"
          },
          "expr": "sum(rate(duplicate_matches_found_total[5m])) by (match_type)",
          "legendFormat": "{{match_type}}",
          "refId": "A"
        }
      ],
      "title": "Duplicate Matches by Match Type",
      "type": "timeseries"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "prometheus"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": null
              },
              {
                "color": "yellow",
                "value": 100
              },
              {
                "color": "red",
                "value": 500
              }
            ]
          },
          "unit": "short"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 6,
        "w": 8,
        "x": 0,
        "y": 14
      },
      "id": 6,
      "options": {
        "colorMode": "background",
        "graphMode": "area",
        "justifyMode": "auto",
        "orientation": "auto",
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "textMode": "auto"
      },
      "targets": [
        {
          "datasource": {
            "type": "prometheus",
            "uid": "prometheus"
          },
          "expr": "kafka_consumergroup_lag{consumergroup=\"duplicate-matching-worker\"}",
          "legendFormat": "{{topic}}",
          "refId": "A"
        }
      ],
      "title": "Duplicate Matching Queue Lag",
      "type": "stat"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "prometheus"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": null
              },
              {
                "color": "yellow",
                "value": 70
              },
              {
                "color": "red",
                "value": 85
              }
            ]
          },
          "unit": "percent"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 6,
        "w": 8,
        "x": 8,
        "y": 14
      },
      "id": 7,
      "options": {
        "colorMode": "background",
        "graphMode": "area",
        "justifyMode": "auto",
        "orientation": "auto",
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "textMode": "auto"
      },
      "targets": [
        {
          "datasource": {
            "type": "prometheus",
            "uid": "prometheus"
          },
          "expr": "avg(rate(container_cpu_usage_seconds_total{namespace=\"nahashield\", pod=~\"duplicate-matching-.*\"}[5m])) by (pod) * 100",
          "legendFormat": "{{pod}}",
          "refId": "A"
        }
      ],
      "title": "Duplicate Matching CPU Usage",
      "type": "gauge"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "prometheus"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": null
              },
              {
                "color": "yellow",
                "value": 70
              },
              {
                "color": "red",
                "value": 85
              }
            ]
          },
          "unit": "percent"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 6,
        "w": 8,
        "x": 16,
        "y": 14
      },
      "id": 8,
      "options": {
        "colorMode": "background",
        "graphMode": "area",
        "justifyMode": "auto",
        "orientation": "auto",
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "textMode": "auto"
      },
      "targets": [
        {
          "datasource": {
            "type": "prometheus",
            "uid": "prometheus"
          },
          "expr": "avg(container_memory_working_set_bytes{namespace=\"nahashield\", pod=~\"duplicate-matching-.*\"}) by (pod) / avg(kube_pod_container_resource_limits{namespace=\"nahashield\", pod=~\"duplicate-matching-.*\", resource=\"memory\"}) by (pod) * 100",
          "legendFormat": "{{pod}}",
          "refId": "A"
        }
      ],
      "title": "Duplicate Matching Memory Usage",
      "type": "gauge"
    }
  ],
  "refresh": "30s",
  "schemaVersion": 39,
  "tags": [
    "nahashield",
    "duplicate-matching",
    "claims",
    "fraud"
  ],
  "templating": {
    "list": [
      {
        "current": {
          "selected": false,
          "text": "All",
          "value": "$__all"
        },
        "includeAll": true,
        "label": "Tenant",
        "name": "tenant",
        "options": [],
        "query": "label_values(nahashield_duplicate_checks_total, tenant_id)",
        "refresh": 2,
        "type": "query"
      },
      {
        "current": {
          "selected": false,
          "text": "All",
          "value": "$__all"
        },
        "includeAll": true,
        "label": "Match Type",
        "name": "match_type",
        "options": [],
        "query": "label_values(nahashield_duplicate_matches_total, match_type)",
        "refresh": 2,
        "type": "query"
      }
    ]
  },
  "time": {
    "from": "now-6h",
    "to": "now"
  },
  "timezone": "browser",
  "title": "NahaShield — Duplicate Matching",
  "uid": "nahashield-duplicate-matching",
  "version": 1,
  "weekStart": ""
}
```

## 2. Database query tuning for fuzzy matching

### 2.1 Enable pg_trgm

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

PostgreSQL’s `pg_trgm` module provides trigram-based similarity functions and index operator classes for fast similar-string search. [postgresql](https://www.postgresql.org/docs/current/pgtrgm.html)

### 2.2 Add trigram indexes

```sql
CREATE INDEX idx_persons_full_name_trgm
ON persons USING GIN (full_name gin_trgm_ops);

CREATE INDEX idx_persons_phone_hash_trgm
ON persons USING GIN (phone_hash gin_trgm_ops);

CREATE INDEX idx_persons_email_hash_trgm
ON persons USING GIN (email_hash gin_trgm_ops);

CREATE INDEX idx_persons_address_hash_trgm
ON persons USING GIN (address_hash gin_trgm_ops);
```

### 2.3 Add exact-match indexes

```sql
CREATE INDEX idx_persons_tenant_id_hash
ON persons (tenant_id, id_number_hash);

CREATE INDEX idx_persons_tenant_phone_hash
ON persons (tenant_id, phone_hash);

CREATE INDEX idx_persons_tenant_email_hash
ON persons (tenant_id, email_hash);

CREATE INDEX idx_persons_tenant_address_hash
ON persons (tenant_id, address_hash);

CREATE INDEX idx_claims_tenant_deceased
ON claims (tenant_id, deceased_person_id);

CREATE INDEX idx_claims_tenant_claimant
ON claims (tenant_id, claimant_person_id);

CREATE INDEX idx_duplicate_matches_tenant_source
ON duplicate_matches (tenant_id, source_claim_id);

CREATE INDEX idx_duplicate_matches_tenant_target
ON duplicate_matches (tenant_id, target_claim_id);
```

### 2.4 Candidate-query pattern

Do not run expensive fuzzy matching against the entire database. First narrow the candidate set using tenant, exact hashes, and indexed fields.

```sql
WITH candidate_persons AS (
  SELECT
    p.person_id,
    p.tenant_id,
    p.id_number_hash,
    p.full_name,
    p.date_of_birth,
    p.phone_hash,
    p.address_hash,
    similarity(p.full_name, $1) AS name_similarity
  FROM persons p
  WHERE p.tenant_id = $2
    AND (
      p.id_number_hash = $3
      OR p.phone_hash = $4
      OR p.address_hash = $5
      OR p.full_name % $1
    )
  ORDER BY
    name_similarity DESC,
    p.id_number_hash = $3 DESC,
    p.phone_hash = $4 DESC,
    p.address_hash = $5 DESC
  LIMIT 200
)
SELECT
  c.claim_id,
  c.deceased_person_id,
  c.claimant_person_id,
  cp.person_id AS candidate_person_id,
  cp.name_similarity,
  CASE
    WHEN cp.id_number_hash = $3 THEN 1.00
    WHEN cp.phone_hash = $4 THEN 0.80
    WHEN cp.address_hash = $5 THEN 0.65
    ELSE cp.name_similarity
  END AS match_score
FROM claims c
JOIN candidate_persons cp
  ON cp.person_id = c.deceased_person_id
WHERE c.tenant_id = $2
  AND c.claim_id <> $6
ORDER BY match_score DESC
LIMIT 50;
```

### 2.5 Query-tuning rules

| Rule | Why |
|---|---|
| Always filter by `tenant_id` first | Prevents cross-tenant scans and improves index use |
| Use exact-hash matching before fuzzy matching | Reduces expensive similarity calculations |
| Limit fuzzy candidates to 200 | Prevents unbounded scans |
| Use `EXPLAIN (ANALYZE, BUFFERS)` | Shows actual execution plan and I/O |
| Avoid `ILIKE '%term%'` without trigram index | Causes sequential scans |
| Use partial indexes for active claims | Reduces index size and improves performance |
| Cache frequent match results | Reduces repeated graph and database queries |
| Use read replicas for matching | Protects transactional claim processing |

### 2.6 Partial indexes

```sql
CREATE INDEX idx_claims_active_tenant_deceased
ON claims (tenant_id, deceased_person_id)
WHERE status IN ('received', 'under_review', 'on_hold');

CREATE INDEX idx_claims_active_tenant_claimant
ON claims (tenant_id, claimant_person_id)
WHERE status IN ('received', 'under_review', 'on_hold');

CREATE INDEX idx_duplicate_signals_open_tenant
ON duplicate_signals (tenant_id, rule_id, match_confidence DESC)
WHERE status = 'open';
```

PostgreSQL supports partial indexes, which index only the subset of rows defined by a predicate. 

### 2.7 EXPLAIN example

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM persons
WHERE tenant_id = 'ten_001'
  AND full_name % 'John Mokoena'
ORDER BY similarity(full_name, 'John Mokoena') DESC
LIMIT 50;
```

## 3. Chaos engineering experiments

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
| Insurer API failure | NahaShield degrades gracefully | One insurer connector | No data loss | Restore connector |
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

## 4. Incident response runbook for load spikes

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

## 5. Terraform infrastructure configuration

Save as `infrastructure/terraform/main.tf`.

```hcl
terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.25"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.13"
    }
  }

  backend "s3" {
    bucket         = "nahashield-terraform-state"
    key            = "prod/nahashield.tfstate"
    region         = "af-south-1"
    encrypt        = true
    dynamodb_table = "nahashield-terraform-lock"
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "af-south-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.20.0.0/16"
}

variable "private_subnet_cidrs" {
  description = "Private subnet CIDR blocks"
  type        = list(string)
  default = [
    "10.20.1.0/24",
    "10.20.2.0/24",
    "10.20.3.0/24"
  ]
}

variable "public_subnet_cidrs" {
  description = "Public subnet CIDR blocks"
  type        = list(string)
  default = [
    "10.20.11.0/24",
    "10.20.12.0/24",
    "10.20.13.0/24"
  ]
}

variable "eks_cluster_name" {
  description = "EKS cluster name"
  type        = string
  default     = "nahashield-prod"
}

variable "rds_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.r6g.large"
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.r6g.large"
}

resource "aws_vpc" "nahashield" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name        = "nahashield-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_subnet" "private" {
  count             = length(var.private_subnet_cidrs)
  vpc_id            = aws_vpc.nahashield.id
  cidr_block        = var.private_subnet_cidrs[count.index]
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name        = "nahashield-private-${count.index}"
    Environment = var.environment
  }
}

resource "aws_subnet" "public" {
  count             = length(var.public_subnet_cidrs)
  vpc_id            = aws_vpc.nahashield.id
  cidr_block        = var.public_subnet_cidrs[count.index]
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name        = "nahashield-public-${count.index}"
    Environment = var.environment
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_eks_cluster" "nahashield" {
  name     = var.eks_cluster_name
  role_arn = aws_iam_role.eks_cluster.arn

  vpc_config {
    subnet_ids              = concat(aws_subnet.private[*].id, aws_subnet.public[*].id)
    endpoint_private_access = true
    endpoint_public_access  = true
  }

  tags = {
    Name        = var.eks_cluster_name
    Environment = var.environment
  }
}

resource "aws_iam_role" "eks_cluster" {
  name = "nahashield-eks-cluster-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "eks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "eks_cluster_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
  role       = aws_iam_role.eks_cluster.name
}

resource "aws_eks_node_group" "nahashield" {
  cluster_name    = aws_eks_cluster.nahashield.name
  node_group_name = "nahashield-workers"
  node_role_arn   = aws_iam_role.eks_node.arn

  scaling_config {
    desired_size = 3
    max_size     = 10
    min_size     = 3
  }

  instance_types = ["m6i.large"]

  tags = {
    Name        = "nahashield-workers"
    Environment = var.environment
  }
}

resource "aws_iam_role" "eks_node" {
  name = "nahashield-eks-node-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "eks_node_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
  role       = aws_iam_role.eks_node.name
}

resource "aws_iam_role_policy_attachment" "eks_cni_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
  role       = aws_iam_role.eks_node.name
}

resource "aws_iam_role_policy_attachment" "ecr_read_only" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
  role       = aws_iam_role.eks_node.name
}

resource "aws_db_subnet_group" "nahashield" {
  name       = "nahashield-db-subnet-group"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name        = "nahashield-db-subnet-group"
    Environment = var.environment
  }
}

resource "aws_db_instance" "nahashield" {
  identifier             = "nahashield-postgres"
  engine                 = "postgres"
  engine_version         = "16.4"
  instance_class         = var.rds_instance_class
  allocated_storage      = 100
  max_allocated_storage  = 1000
  storage_encrypted      = true
  db_name                = "nahashield"
  username               = "nahashield_admin"
  password               = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.nahashield.name
  multi_az               = true
  publicly_accessible    = false
  backup_retention_period = 30
  deletion_protection    = true

  tags = {
    Name        = "nahashield-postgres"
    Environment = var.environment
  }
}

variable "db_password" {
  description = "RDS master password"
  type        = string
  sensitive   = true
}

resource "aws_elasticache_replication_group" "nahashield" {
  replication_group_id = "nahashield-redis"
  description          = "NahaShield Redis cache"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.redis_node_type
  num_cache_clusters   = 2
  automatic_failover_enabled = true
  subnet_group_name    = aws_elasticache_subnet_group.nahashield.name
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  tags = {
    Name        = "nahashield-redis"
    Environment = var.environment
  }
}

resource "aws_elasticache_subnet_group" "nahashield" {
  name       = "nahashield-cache-subnet-group"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_msk_cluster" "nahashield" {
  cluster_name           = "nahashield-kafka"
  kafka_version          = "3.6.0"
  number_of_broker_nodes = 3

  broker_node_group_info {
    client_subnets = aws_subnet.private[*].id

    instance_type = "kafka.m5.large"

    storage_info {
      ebs_storage_info {
        volume_size = 200
      }
    }
  }

  encryption_info {
    encryption_in_transit {
      client_broker = "TLS"
      in_cluster    = true
    }
  }

  tags = {
    Name        = "nahashield-kafka"
    Environment = var.environment
  }
}

resource "aws_s3_bucket" "evidence_vault" {
  bucket = "nahashield-evidence-vault"

  tags = {
    Name        = "nahashield-evidence-vault"
    Environment = var.environment
  }
}

resource "aws_s3_bucket_versioning" "evidence_vault" {
  bucket = aws_s3_bucket.evidence_vault.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidence_vault" {
  bucket = aws_s3_bucket.evidence_vault.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "evidence_vault" {
  bucket = aws_s3_bucket.evidence_vault.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudwatch_log_group" "nahashield" {
  name              = "/aws/eks/nahashield/prod"
  retention_in_days = 365

  tags = {
    Name        = "nahashield-logs"
    Environment = var.environment
  }
}

resource "aws_wafv2_web_acl" "nahashield" {
  name  = "nahashield-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "nahashield-waf"
    sampled_requests_enabled   = true
  }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name         = "AWS"
        name                = "AWSManagedRulesCommonRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "nahashield-common-rules"
      sampled_requests_enabled   = true
    }
  }
}
```

## 6. Sources

- Grafana dashboard JSON model: dashboards contain metadata, panels, variables, and queries. [grafana](https://grafana.com/docs/grafana/v12.4/visualizations/dashboards/build-dashboards/view-dashboard-json-model/)
- Grafana dashboard HTTP API: classic JSON model uses `panels`, `templating`, and `time`. [grafana](https://grafana.com/docs/grafana-cloud/learn-and-build/developer-resources/api-reference/http-api/dashboard/)
- PostgreSQL `pg_trgm`: trigram similarity and index operator classes for fast similar-string search. [postgresql](https://www.postgresql.org/docs/current/pgtrgm.html)
- PostgreSQL partial indexes: useful for indexing only a relevant subset of rows.
