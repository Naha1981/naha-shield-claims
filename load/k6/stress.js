// NahaShield k6 stress suite (spec 4). LOCAL/SYNTHETIC TARGETS ONLY.
// Never point BASE_URL at staging or the live site. No secrets, no real data.
// Run: k6 run -e BASE_URL=http://127.0.0.1:3100 load/k6/stress.js
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(__ENV.BASE_URL || '')) { throw new Error('BASE_URL must be a local address (http://127.0.0.1 or http://localhost). Never load-test staging or live.'); }

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
