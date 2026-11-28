// ClaimTrace k6 soak suite (spec 4). LOCAL/SYNTHETIC TARGETS ONLY.
// Never point BASE_URL at staging or the live site. No secrets, no real data.
// Run: k6 run -e BASE_URL=http://127.0.0.1:3100 load/k6/soak.js
// Seeds its own synthetic claims in setup(): reads hit seeded ids in the soak tenant.
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(__ENV.BASE_URL || '')) { throw new Error('BASE_URL must be a local address (http://127.0.0.1 or http://localhost). Never load-test staging or live.'); }

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = `${__ENV.BASE_URL}/api/v1`;
const TENANT = __ENV.TENANT_ID || 'ten_k6_soak';
const HEADERS = {
  'Content-Type': 'application/json',
  'Origin': __ENV.BASE_URL,
  'x-nahashield-demo-role': 'claims_manager',
  'x-tenant-id': TENANT,
};

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

export function setup() {
  const ids = [];
  let cookie = '';
  for (let i = 0; i < 50; i += 1) {
    const res = http.post(`${BASE}/claims`, JSON.stringify({
      policy_id: `pol_soak_${i}`,
      claim_type: 'life',
      amount_claimed_cents: 100000 + i * 1000,
      consent_id: `cns_soak_${i}`,
      channel: 'load_test',
      deceased_person_id: `hash_soak_dec_${i % 6}`,
      claimant_person_id: `hash_soak_clm_${i % 8}`,
    }), { headers: { ...HEADERS, 'Idempotency-Key': `soak-seed-${i}` } });
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
  const response = http.get(`${BASE}/claims/${claimId}`, { headers: { ...HEADERS, 'Cookie': data.cookie } });

  check(response, {
    'status is 200': (r) => r.status === 200
  });

  sleep(2);
}
