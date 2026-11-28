// NahaShield k6 soak suite (spec 4). LOCAL/SYNTHETIC TARGETS ONLY.
// Never point BASE_URL at staging or the live site. No secrets, no real data.
// Run: k6 run -e BASE_URL=http://127.0.0.1:3100 load/k6/soak.js
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(__ENV.BASE_URL || '')) { throw new Error('BASE_URL must be a local address (http://127.0.0.1 or http://localhost). Never load-test staging or live.'); }

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
