// NahaShield k6 load suite (spec 4). LOCAL/SYNTHETIC TARGETS ONLY.
// Never point BASE_URL at staging or the live site. No secrets, no real data.
// Run: k6 run -e BASE_URL=http://127.0.0.1:3100 load/k6/load.js
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(__ENV.BASE_URL || '')) { throw new Error('BASE_URL must be a local address (http://127.0.0.1 or http://localhost). Never load-test staging or live.'); }

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
