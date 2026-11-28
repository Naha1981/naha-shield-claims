Below is the complete **load and performance testing suite**, **mock-data generator**, **CI pipeline**, **fuzzy-threshold edge cases**, and **test-execution report template** for NahaShield’s cross-claim matching engine.

## 1. Load and performance testing suite

### 1.1 Objectives

| Objective | Measure |
|---|---|
| Validate normal load | p95 latency, error rate, throughput |
| Validate peak load | p95 latency, error rate, queue depth |
| Validate stress point | VU count and request rate at which performance degrades |
| Validate soak stability | Memory, CPU, database connections, error rate over time |
| Validate burst handling | Recovery time after spike |
| Validate duplicate-check throughput | Checks per minute |
| Validate graph-query performance | p95 latency for deep-link queries |
| Validate privacy under load | No sensitive data in logs |

Use p95 and p99 rather than averages, because averages can hide slow outliers; k6 recommends thresholds based on observed baselines with headroom. [k6](https://k6.io/our-beliefs/)

### 1.2 Environments

| Environment | Purpose | Data |
|---|---|---|
| Local | Developer testing | Synthetic seed data |
| CI | Automated regression and smoke load test | Small synthetic dataset |
| Staging | Full performance and soak testing | Large synthetic dataset |
| Insurer pilot | Controlled pilot validation | Pseudonymised insurer data |

### 1.3 Load profiles

| Profile | Virtual users | Duration | Ramp-up | Purpose |
|---|---:|---:|---:|---|
| Smoke | 5 | 2 minutes | 30 seconds | Verify basic availability |
| Baseline | 25 | 10 minutes | 2 minutes | Establish normal performance |
| Load | 100 | 20 minutes | 5 minutes | Validate expected production load |
| Peak | 250 | 30 minutes | 5 minutes | Validate seasonal or campaign peak |
| Stress | 500 | 30 minutes | 10 minutes | Find breaking point |
| Soak | 100 | 4 hours | 5 minutes | Detect memory leaks and degradation |
| Burst | 500 | 5 minutes | 30 seconds | Validate autoscaling and queue handling |

### 1.4 Service-level targets

| Endpoint | p95 target | p99 target | Error-rate target | Throughput target |
|---|---:|---:|---:|---:|
| `POST /v1/duplicate-checks` | 1,500 ms | 3,000 ms | Below 1% | 100 checks/min |
| `GET /v1/duplicate-checks/{id}` | 300 ms | 800 ms | Below 0.5% | 500 req/min |
| `GET /v1/claims/{id}` | 300 ms | 800 ms | Below 0.5% | 500 req/min |
| `GET /v1/claims` | 500 ms | 1,200 ms | Below 0.5% | 300 req/min |
| `POST /v1/claims/{id}/checks` | 2,000 ms | 4,000 ms | Below 1% | 50 checks/min |
| `POST /v1/fraud/score-claim` | 1,000 ms | 2,000 ms | Below 1% | 100 scores/min |
| `GET /v1/fraud-graph/{claim_id}` | 2,000 ms | 4,000 ms | Below 1% | 50 queries/min |
| `POST /v1/notifications` | 500 ms | 1,000 ms | Below 1% | 200 messages/min |

Start with observed p95 values and add 20–50% headroom; use p99 for latency-sensitive paths such as authentication, payments, and duplicate checks. [grafana](https://grafana.com/docs/learning-hub/k6-performance-testing/03-establishing-a-baseline/19-results-to-thresholds/)

### 1.5 k6 test script

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Trend, Rate } from 'k6/metrics';

const duplicateCheckDuration = new Trend('duplicate_check_duration');
const duplicateCheckFailureRate = new Rate('duplicate_check_failure_rate');

const payloads = new SharedArray('duplicate_payloads', function () {
  return JSON.parse(open('./data/duplicate-check-payloads.json'));
});

export const options = {
  scenarios: {
    duplicate_checks: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 25 },
        { duration: '10m', target: 25 },
        { duration: '2m', target: 0 }
      ],
      gracefulRampDown: '30s'
    }
  },
  thresholds: {
    'http_req_duration{endpoint:duplicate_check}': ['p(95)<1500', 'p(99)<3000'],
    'http_req_failed{endpoint:duplicate_check}': ['rate<0.01'],
    'duplicate_check_duration': ['p(95)<1500'],
    'duplicate_check_failure_rate': ['rate<0.01'],
    'checks': ['rate>0.99']
  }
};

export default function () {
  const payload = payloads[Math.floor(Math.random() * payloads.length)];

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${__ENV.API_TOKEN}`,
      'X-Tenant-ID': __ENV.TENANT_ID,
      'Idempotency-Key': `${payload.request_id}`,
      'X-Request-ID': `${payload.request_id}`
    },
    tags: {
      endpoint: 'duplicate_check'
    }
  };

  const response = http.post(
    `${__ENV.BASE_URL}/v1/duplicate-checks`,
    JSON.stringify(payload),
    params
  );

  duplicateCheckDuration.add(response.timings.duration);
  duplicateCheckFailureRate.add(response.status >= 400);

  check(response, {
    'status is 200 or 202': (r) => [200, 202].includes(r.status),
    'has duplicate_check_id': (r) => r.json('duplicate_check_id') !== undefined,
    'has risk score': (r) => r.json('duplicate_risk_score') !== undefined,
    'no accusation wording': (r) => !r.body.includes('fraudster')
  });

  sleep(1);
}
```

### 1.6 Stress-test script

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 1000,
      stages: [
        { duration: '5m', target: 50 },
        { duration: '10m', target: 150 },
        { duration: '10m', target: 300 },
        { duration: '5m', target: 0 }
      ]
    }
  },
  thresholds: {
    'http_req_duration': ['p(95)<2000', 'p(99)<4000'],
    'http_req_failed': ['rate<0.02'],
    'checks': ['rate>0.98']
  }
};

export default function () {
  const payload = JSON.stringify({
    request_id: `stress_${__VU}_${__ITER}`,
    tenant_id: __ENV.TENANT_ID,
    claim_id: `clm_${Math.floor(Math.random() * 100000)}`,
    check_scope: [
      'same_deceased',
      'same_claimant',
      'same_beneficiary',
      'same_bank_account',
      'same_device'
    ]
  });

  const response = http.post(
    `${__ENV.BASE_URL}/v1/duplicate-checks`,
    payload,
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${__ENV.API_TOKEN}`,
        'X-Tenant-ID': __ENV.TENANT_ID,
        'Idempotency-Key': `stress_${__VU}_${__ITER}`
      }
    }
  );

  check(response, {
    'status is 200 or 202': (r) => [200, 202].includes(r.status)
  });

  sleep(0.5);
}
```

### 1.7 Soak-test script

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: 100,
      duration: '4h'
    }
  },
  thresholds: {
    'http_req_duration': ['p(95)<1500'],
    'http_req_failed': ['rate<0.01'],
    'checks': ['rate>0.99']
  }
};

export default function () {
  const response = http.get(
    `${__ENV.BASE_URL}/v1/claims/clm_${Math.floor(Math.random() * 100000)}`,
    {
      headers: {
        'Authorization': `Bearer ${__ENV.API_TOKEN}`,
        'X-Tenant-ID': __ENV.TENANT_ID
      }
    }
  );

  check(response, {
    'status is 200': (r) => r.status === 200
  });

  sleep(2);
}
```

## 2. Mock-data generator script

### 2.1 Purpose

Generate deterministic, synthetic, privacy-safe test data for:

- Clean claims.
- Duplicate claims.
- Duplicate policies.
- Mule accounts.
- Shared agents.
- Shared devices.
- Shared addresses.
- Innocent controls.
- Cross-insurer cases.
- Boundary cases.
- Load-test payloads.

### 2.2 Generator design

Use a fixed random seed so every run produces the same dataset.

```bash
python scripts/generate_test_data.py \
  --seed 42 \
  --tenants 3 \
  --claims 10000 \
  --duplicate-claims 500 \
  --duplicate-policies 250 \
  --mule-accounts 100 \
  --shared-agents 100 \
  --shared-devices 100 \
  --shared-addresses 100 \
  --innocent-controls 1000 \
  --cross-insurer-cases 100 \
  --output-dir ./data
```

### 2.3 Python generator

```python
import argparse
import json
import random
import uuid
from datetime import datetime, timedelta
from pathlib import Path

def sha256_hash(value: str) -> str:
    import hashlib
    return hashlib.sha256(value.encode()).hexdigest()

def make_person(seed: int, tenant_id: str) -> dict:
    rng = random.Random(seed)
    person_id = f"psn_{uuid.UUID(int=rng.getrandbits(128))}"
    id_number = f"{rng.randint(1000000000, 9999999999):010d}"
    return {
        "person_id": person_id,
        "tenant_id": tenant_id,
        "id_number_hash": sha256_hash(id_number),
        "full_name": f"Test Person {seed}",
        "date_of_birth": "1980-01-01",
        "phone_hash": sha256_hash(f"phone_{seed}"),
        "email_hash": sha256_hash(f"email_{seed}"),
        "address_hash": sha256_hash(f"address_{seed}")
    }

def make_claim(seed: int, tenant_id: str, person: dict) -> dict:
    rng = random.Random(seed)
    claim_id = f"clm_{uuid.UUID(int=rng.getrandbits(128))}"
    return {
        "claim_id": claim_id,
        "tenant_id": tenant_id,
        "policy_id": f"pol_{uuid.UUID(int=rng.getrandbits(128))}",
        "claim_number": f"CLM-{seed:08d}",
        "claim_type": "funeral",
        "status": "received",
        "deceased_person_id": person["person_id"],
        "claimant_person_id": person["person_id"],
        "amount_claimed_cents": rng.randint(1000000, 10000000),
        "submitted_at": datetime.utcnow().isoformat(),
        "agent_id": f"agt_{rng.randint(1, 100):03d}",
        "funeral_parlour_id": f"par_{rng.randint(1, 50):03d}",
        "doctor_id": f"doc_{rng.randint(1, 50):03d}",
        "bank_account_token": f"tok_bank_{rng.randint(1, 1000):04d}",
        "device_fingerprint": f"dev_{rng.randint(1, 1000):04d}",
        "address_hash": person["address_hash"],
        "phone_hash": person["phone_hash"]
    }

def make_duplicate_pair(seed: int, tenant_id: str) -> tuple:
    person = make_person(seed, tenant_id)
    claim_a = make_claim(seed, tenant_id, person)
    claim_b = make_claim(seed + 1000000, tenant_id, person)
    return claim_a, claim_b

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--tenants", type=int, default=3)
    parser.add_argument("--claims", type=int, default=10000)
    parser.add_argument("--duplicate-claims", type=int, default=500)
    parser.add_argument("--duplicate-policies", type=int, default=250)
    parser.add_argument("--mule-accounts", type=int, default=100)
    parser.add_argument("--shared-agents", type=int, default=100)
    parser.add_argument("--shared-devices", type=int, default=100)
    parser.add_argument("--shared-addresses", type=int, default=100)
    parser.add_argument("--innocent-controls", type=int, default=1000)
    parser.add_argument("--cross-insurer-cases", type=int, default=100)
    parser.add_argument("--output-dir", type=str, default="./data")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    tenants = [f"ten_{i:03d}" for i in range(1, args.tenants + 1)]
    claims = []

    for i in range(1, args.claims + 1):
        tenant_id = tenants[i % len(tenants)]
        person = make_person(i, tenant_id)
        claim = make_claim(i, tenant_id, person)
        claims.append(claim)

    duplicate_claims = []
    for i in range(1, args.duplicate_claims + 1):
        tenant_id = tenants[i % len(tenants)]
        claim_a, claim_b = make_duplicate_pair(i, tenant_id)
        duplicate_claims.extend([claim_a, claim_b])

    duplicate_policies = []
    for i in range(1, args.duplicate_policies + 1):
        tenant_id = tenants[i % len(tenants)]
        person = make_person(i + 2000000, tenant_id)
        policy_a = {
            "policy_id": f"pol_{uuid.uuid4()}",
            "tenant_id": tenant_id,
            "insured_person_id": person["person_id"],
            "agent_id": f"agt_{i % 100:03d}"
        }
        policy_b = {
            "policy_id": f"pol_{uuid.uuid4()}",
            "tenant_id": tenant_id,
            "insured_person_id": person["person_id"],
            "agent_id": f"agt_{i % 100:03d}"
        }
        duplicate_policies.extend([policy_a, policy_b])

    mule_accounts = []
    for i in range(1, args.mule_accounts + 1):
        tenant_id = tenants[i % len(tenants)]
        bank_account_token = f"tok_bank_mule_{i:04d}"
        for j in range(5):
            person = make_person(i * 1000 + j, tenant_id)
            claim = make_claim(i * 1000 + j, tenant_id, person)
            claim["bank_account_token"] = bank_account_token
            mule_accounts.append(claim)

    shared_agents = []
    for i in range(1, args.shared_agents + 1):
        tenant_id = tenants[i % len(tenants)]
        agent_id = f"agt_shared_{i:04d}"
        for j in range(5):
            person = make_person(i * 2000 + j, tenant_id)
            claim = make_claim(i * 2000 + j, tenant_id, person)
            claim["agent_id"] = agent_id
            shared_agents.append(claim)

    shared_devices = []
    for i in range(1, args.shared_devices + 1):
        tenant_id = tenants[i % len(tenants)]
        device_fingerprint = f"dev_shared_{i:04d}"
        for j in range(5):
            person = make_person(i * 3000 + j, tenant_id)
            claim = make_claim(i * 3000 + j, tenant_id, person)
            claim["device_fingerprint"] = device_fingerprint
            shared_devices.append(claim)

    shared_addresses = []
    for i in range(1, args.shared_addresses + 1):
        tenant_id = tenants[i % len(tenants)]
        address_hash = sha256_hash(f"shared_address_{i}")
        for j in range(5):
            person = make_person(i * 4000 + j, tenant_id)
            claim = make_claim(i * 4000 + j, tenant_id, person)
            claim["address_hash"] = address_hash
            shared_addresses.append(claim)

    innocent_controls = []
    for i in range(1, args.innocent_controls + 1):
        tenant_id = tenants[i % len(tenants)]
        person = make_person(i + 5000000, tenant_id)
        claim = make_claim(i + 5000000, tenant_id, person)
        innocent_controls.append(claim)

    cross_insurer_cases = []
    for i in range(1, args.cross_insurer_cases + 1):
        tenant_id = tenants[i % len(tenants)]
        person = make_person(i + 6000000, tenant_id)
        claim_a = make_claim(i + 6000000, tenant_id, person)
        claim_b = make_claim(i + 7000000, tenant_id, person)
        claim_b["insurer_id"] = "insurer_b"
        cross_insurer_cases.extend([claim_a, claim_b])

    all_claims = (
        claims
        + duplicate_claims
        + mule_accounts
        + shared_agents
        + shared_devices
        + shared_addresses
        + innocent_controls
        + cross_insurer_cases
    )

    (output_dir / "claims.jsonl").write_text(
        "\n".join(json.dumps(c) for c in all_claims)
    )

    (output_dir / "duplicate_policies.jsonl").write_text(
        "\n".join(json.dumps(p) for p in duplicate_policies)
    )

    duplicate_check_payloads = []
    for claim in all_claims[:5000]:
        duplicate_check_payloads.append({
            "request_id": f"req_{claim['claim_id']}",
            "tenant_id": claim["tenant_id"],
            "claim_id": claim["claim_id"],
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
            "insured_person": {
                "person_id": claim["deceased_person_id"],
                "id_number_hash": sha256_hash(str(claim["claim_id"])),
                "full_name": f"Test Person {claim['claim_id']}",
                "date_of_birth": "1980-01-01"
            },
            "claimant": {
                "person_id": claim["claimant_person_id"],
                "id_number_hash": sha256_hash(str(claim["claim_id"])),
                "full_name": f"Test Claimant {claim['claim_id']}"
            },
            "bank_account_token": claim["bank_account_token"],
            "device_fingerprint": claim["device_fingerprint"],
            "address_hash": claim["address_hash"],
            "phone_hash": claim["phone_hash"],
            "agent_id": claim["agent_id"],
            "funeral_parlour_id": claim["funeral_parlour_id"],
            "doctor_id": claim["doctor_id"],
            "consent_id": "cns_test_consent"
        })

    (output_dir / "duplicate-check-payloads.json").write_text(
        json.dumps(duplicate_check_payloads, indent=2)
    )

if __name__ == "__main__":
    main()
```

## 3. CI pipeline configuration

### 3.1 Pipeline stages

| Stage | Purpose | Failure condition |
|---|---|---|
| Lint | Code quality | Lint errors |
| Unit tests | Business logic | Any test failure |
| Integration tests | API and database | Any test failure |
| Security tests | Secrets, dependencies, SAST | Critical finding |
| Contract tests | API contracts | Contract mismatch |
| Duplicate-match tests | Functional correctness | Any failure |
| Load smoke test | Basic performance | Threshold breach |
| Load regression test | Performance regression | Threshold breach |
| Report upload | Test evidence | Always upload |

GitHub recommends uploading test results, failures, screenshots, and coverage reports as workflow artifacts for long-term storage and debugging. [github](https://github.com/github/awesome-copilot/blob/main/instructions/github-actions-ci-cd-best-practices.instructions.md)

### 3.2 GitHub Actions workflow

```yaml
name: NahaShield CI

on:
  push:
    branches:
      - main
      - develop
  pull_request:
    branches:
      - main
      - develop
  schedule:
    - cron: "0 2 * * *"

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements-dev.txt

      - name: Run lint
        run: |
          ruff check .
          black --check .

  unit-tests:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt
          pip install -r requirements-dev.txt

      - name: Run unit tests
        run: |
          pytest tests/unit --cov=app --cov-report=xml --junitxml=reports/unit.xml

      - uses: actions/upload-artifact@v4
        with:
          name: unit-test-results
          path: reports/

  integration-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: nahashield
          POSTGRES_PASSWORD: test
          POSTGRES_DB: nahashield_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt
          pip install -r requirements-dev.txt

      - name: Run integration tests
        env:
          DATABASE_URL: postgresql://nahashield:test@localhost:5432/nahashield_test
        run: |
          pytest tests/integration --junitxml=reports/integration.xml

      - uses: actions/upload-artifact@v4
        with:
          name: integration-test-results
          path: reports/

  duplicate-match-tests:
    runs-on: ubuntu-latest
    needs: integration-tests
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt
          pip install -r requirements-dev.txt

      - name: Generate synthetic test data
        run: |
          python scripts/generate_test_data.py \
            --seed 42 \
            --tenants 3 \
            --claims 10000 \
            --duplicate-claims 500 \
            --duplicate-policies 250 \
            --mule-accounts 100 \
            --shared-agents 100 \
            --shared-devices 100 \
            --shared-addresses 100 \
            --innocent-controls 1000 \
            --cross-insurer-cases 100 \
            --output-dir ./data

      - name: Run duplicate-match tests
        run: |
          pytest tests/duplicate_matching --junitxml=reports/duplicate-matching.xml

      - uses: actions/upload-artifact@v4
        with:
          name: duplicate-match-test-results
          path: reports/

  load-smoke-test:
    runs-on: ubuntu-latest
    needs: duplicate-match-tests
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install k6
        run: |
          sudo gpg -k
          sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
          echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update
          sudo apt-get install k6

      - name: Generate load-test data
        run: |
          python scripts/generate_test_data.py \
            --seed 42 \
            --tenants 1 \
            --claims 1000 \
            --duplicate-claims 50 \
            --duplicate-policies 25 \
            --mule-accounts 10 \
            --shared-agents 10 \
            --shared-devices 10 \
            --shared-addresses 10 \
            --innocent-controls 100 \
            --cross-insurer-cases 10 \
            --output-dir ./data

      - name: Run k6 smoke test
        env:
          BASE_URL: ${{ secrets.STAGING_BASE_URL }}
          API_TOKEN: ${{ secrets.STAGING_API_TOKEN }}
          TENANT_ID: ${{ secrets.STAGING_TENANT_ID }}
        run: |
          k6 run tests/load/smoke.js --summary-export=reports/load-smoke.json

      - uses: actions/upload-artifact@v4
        with:
          name: load-smoke-results
          path: reports/

  load-regression-test:
    runs-on: ubuntu-latest
    needs: load-smoke-test
    if: github.event_name == 'schedule'
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install k6
        run: |
          sudo gpg -k
          sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
          echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update
          sudo apt-get install k6

      - name: Generate load-test data
        run: |
          python scripts/generate_test_data.py \
            --seed 42 \
            --tenants 3 \
            --claims 10000 \
            --duplicate-claims 500 \
            --duplicate-policies 250 \
            --mule-accounts 100 \
            --shared-agents 100 \
            --shared-devices 100 \
            --shared-addresses 100 \
            --innocent-controls 1000 \
            --cross-insurer-cases 100 \
            --output-dir ./data

      - name: Run k6 load regression
        env:
          BASE_URL: ${{ secrets.STAGING_BASE_URL }}
          API_TOKEN: ${{ secrets.STAGING_API_TOKEN }}
          TENANT_ID: ${{ secrets.STAGING_TENANT_ID }}
        run: |
          k6 run tests/load/load.js --summary-export=reports/load-regression.json

      - uses: actions/upload-artifact@v4
        with:
          name: load-regression-results
          path: reports/
```

### 3.3 CI thresholds

```javascript
export const options = {
  thresholds: {
    'http_req_duration{endpoint:duplicate_check}': ['p(95)<1500', 'p(99)<3000'],
    'http_req_failed{endpoint:duplicate_check}': ['rate<0.01'],
    'checks': ['rate>0.99']
  }
};
```

CI thresholds should be based on actual performance baselines, not arbitrary numbers; p95 is a good primary threshold, with p99 for latency-sensitive paths. [grafana](https://grafana.com/docs/learning-hub/k6-performance-testing/01-intro/02-what-is-perf-testing/)

## 4. Fuzzy-match threshold edge cases

### 4.1 Threshold bands

| Score | Risk level | Recommended action | Human review |
|---:|---|---|---|
| 0–39 | Low | `no_action` or `monitor_only` | No |
| 40–59 | Medium | `monitor_only` | Yes |
| 60–69 | Medium | `request_call_back` | Yes |
| 70–84 | High | `request_call_back` or `investigate` | Yes |
| 85–100 | High | `hold_and_investigate` | Yes |

### 4.2 Edge cases

| Test ID | Scenario | Input | Expected result |
|---|---|---|---|
| TC-FUZZ-001 | Exact ID match | Same ID hash | Match confidence 1.00 |
| TC-FUZZ-002 | One character difference in name | Same ID hash | Match confidence 0.98 |
| TC-FUZZ-003 | Same name, different ID | Different ID hash | Match confidence below 0.40 |
| TC-FUZZ-004 | Same surname only | Different ID and DOB | Match confidence below 0.25 |
| TC-FUZZ-005 | Same DOB only | Different ID and name | Match confidence below 0.30 |
| TC-FUZZ-006 | Same phone only | Different ID and name | Match confidence 0.55 |
| TC-FUZZ-007 | Same address only | Different ID and name | Match confidence 0.50 |
| TC-FUZZ-008 | Same device only | Different ID and name | Match confidence 0.60 |
| TC-FUZZ-009 | Same bank account only | Different ID and name | Match confidence 0.85 |
| TC-FUZZ-010 | Same agent only | Different ID and name | Match confidence 0.45 |
| TC-FUZZ-011 | Same funeral parlour only | Different ID and name | Match confidence 0.40 |
| TC-FUZZ-012 | Same doctor only | Different ID and name | Match confidence 0.40 |
| TC-FUZZ-013 | Same document hash | Different claim | Match confidence 0.97 |
| TC-FUZZ-014 | Same perceptual hash | Different claim | Match confidence 0.88 |
| TC-FUZZ-015 | Transposed ID digits | Likely typo | Match confidence 0.70 |
| TC-FUZZ-016 | Name spelling variation | Same ID hash | Match confidence 0.95 |
| TC-FUZZ-017 | Name transliteration | Same ID hash | Match confidence 0.90 |
| TC-FUZZ-018 | Hyphenated surname | Same ID hash | Match confidence 0.95 |
| TC-FUZZ-019 | Maiden name | Same ID hash | Match confidence 0.90 |
| TC-FUZZ-020 | Nickname | Same ID hash | Match confidence 0.85 |
| TC-FUZZ-021 | Empty name | Same ID hash | Match confidence 0.90 |
| TC-FUZZ-022 | Empty DOB | Same ID hash | Match confidence 0.85 |
| TC-FUZZ-023 | Empty phone | Same ID hash | Match confidence 0.80 |
| TC-FUZZ-024 | Empty address | Same ID hash | Match confidence 0.80 |
| TC-FUZZ-025 | Missing bank account | Same ID hash | Match confidence 0.75 |
| TC-FUZZ-026 | Missing device | Same ID hash | Match confidence 0.75 |
| TC-FUZZ-027 | Missing agent | Same ID hash | Match confidence 0.75 |
| TC-FUZZ-028 | Missing provider | Same ID hash | Match confidence 0.75 |
| TC-FUZZ-029 | Missing document | Same ID hash | Match confidence 0.75 |
| TC-FUZZ-030 | All fields missing except ID | Same ID hash | Match confidence 0.95 |

## 5. Test execution report template

```markdown
# NahaShield Cross-Claim Matching Test Execution Report

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
```

## 6. Sources

- k6 performance-testing guidance: thresholds, p95/p99, error rate, checks, and baseline establishment. [k6](https://k6.io/our-beliefs/)
- k6 CI guidance: thresholds should be based on observed baselines, not arbitrary numbers. [grafana](https://grafana.com/docs/learning-paths/automate-k6-cicd/verify-thresholds/)
- GitHub Actions artifact guidance: upload test results, failures, screenshots, and coverage reports. [github](https://github.com/github/awesome-copilot/blob/main/instructions/github-actions-ci-cd-best-practices.instructions.md)
- Test-design guidance: equivalence partitioning and boundary-value analysis.
