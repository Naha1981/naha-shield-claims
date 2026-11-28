// ClaimTrace k6 stress suite (spec 4). LOCAL/SYNTHETIC TARGETS ONLY.
// Never point BASE_URL at staging or the live site. No secrets, no real data.
// Run: k6 run -e BASE_URL=http://127.0.0.1:3100 load/k6/stress.js
// Seeds its own synthetic claims in setup(): duplicate-checks require an existing claim.
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(__ENV.BASE_URL || '')) { throw new Error('BASE_URL must be a local address (http://127.0.0.1 or http://localhost). Never load-test staging or live.'); }

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = `${__ENV.BASE_URL}/api/v1`;
const TENANT = __ENV.TENANT_ID || 'ten_k6_stress';
const HEADERS = {
  'Content-Type': 'application/json',
  'Origin': __ENV.BASE_URL,
  'x-nahashield-demo-role': 'claims_manager',
  'x-tenant-id': TENANT,
};

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

export function setup() {
  const ids = [];
  let cookie = '';
  for (let i = 0; i < 50; i += 1) {
    const res = http.post(`${BASE}/claims`, JSON.stringify({
      policy_id: `pol_k6s_${i}`,
      claim_type: 'life',
      amount_claimed_cents: 100000 + i * 1000,
      consent_id: `cns_k6s_${i}`,
      channel: 'load_test',
      deceased_person_id: `hash_k6s_dec_${i % 6}`,
      claimant_person_id: `hash_k6s_clm_${i % 8}`,
    }), { headers: { ...HEADERS, 'Idempotency-Key': `k6s-seed-${i}` } });
    if (res.status !== 201) throw new Error(`seed claim ${i} failed: ${res.status} ${res.body}`);
    ids.push(res.json().claim_id);
    if (i === 0) {
      const ws = res.cookies.nahashield_workspace;
      cookie = ws && ws[0] ? `nahashield_workspace=${ws[0].value}` : '';
    }
  }
  // Reuse one workspace cookie for the whole run: without it the isolation middleware
  // creates a new synthetic workspace per request and the run hits its 200-workspace cap (503).
  if (!cookie) throw new Error('no workspace cookie issued by seed response');
  return { claimIds: ids, cookie };
}

export default function (data) {
  const claimId = data.claimIds[Math.floor(Math.random() * data.claimIds.length)];
  const scope = ['same_deceased', 'same_claimant', 'same_beneficiary', 'same_bank_account', 'same_device'];
  const payload = JSON.stringify({
    request_id: `stress_${__VU}_${__ITER}`,
    tenant_id: TENANT,
    claim_id: claimId,
    consent_id: 'cns_k6_stress',
    check_scope: scope.slice(0, (__ITER % scope.length) + 1),
  });

  const response = http.post(`${BASE}/duplicate-checks`, payload, {
    headers: { ...HEADERS, 'Idempotency-Key': `stress_${__VU}_${__ITER}` }
  });

  check(response, {
    'status is 200/201/202': (r) => [200, 201, 202].includes(r.status)
  });

  sleep(0.5);
}
