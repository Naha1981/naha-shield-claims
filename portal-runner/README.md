# NahaShield Synthetic Portal Runner (isolated)

An isolated browser/portal runner agent for NahaShield. It opens a **synthetic
claims portal target only** (the NahaShield app served on loopback with its
built-in synthetic seed data), reads an assigned synthetic case, fills
allowlisted draft fields, captures SHA-256-hashed screenshots, and **stops at
final submit for human approval — always**. There is no code path that
submits, and the network layer physically denies writes and non-allowlisted
hosts.

It also implements **record-and-replay skills**: a demonstrated flow can be
recorded once into a digest-sealed skill file (data, never scripts), every
successful checkpointed workflow is auto-saved as a skill, and replay runs
the exact saved steps only after a consumed human approval token bound to
that skill's digest. Replay can never submit.

Ported from the isolated morning build (`claims-worker-step1`:
computer-mcp.mjs, staging-server.mjs, approval-security.mjs, audit.mjs) onto
commit `2607629`. Free/open-source only: [Playwright](https://playwright.dev)
(Apache-2.0) driving system Chromium/Chrome.

## Safety invariants (enforced by the executor, not the caller)

1. Loopback-only portal target: any non-`http://127.0.0.1|localhost` origin
   throws `PORTAL_URL_DENIED` at boot and per request.
2. Request interception aborts everything off-origin (`network-denied`) and
   every non-GET/HEAD method (`write-denied`), both logged.
3. Synthetic cases only: refs must match `^SYN-[A-Z0-9-]+$` and be on the
   assigned-case allowlist (`WRONG_CASE_DENIED` otherwise).
4. Draft fills restricted to an allowlist of draft fields; button clicks
   restricted to allowlisted safe (preview) buttons.
5. `request_final_submission` never clicks anything and always returns
   `HUMAN_APPROVAL_REQUIRED` with `submitted: false`.
6. Every screenshot is SHA-256 hashed; every action is appended to a
   hash-chained audit log (`evidence/worker-audit.jsonl`).
7. Vault sealing requires a consumed human reviewer approval token bound to
   the exact run-report digest and case ref. Forged/unused tokens refuse.
8. Skills are JSON step lists (no scripts) sealed with a SHA-256 digest over
   the canonical step JSON. Replay verifies the digest
   (`SKILL_DIGEST_MISMATCH`), statically restricts every step to the portal's
   registered allowlists — draft fields, safe preview buttons, assigned
   synthetic cases, and the `/recovery` page for navigation
   (`SKILL_STEP_DENIED`) — then atomically claims one execution of a consumed
   `SKILL_REPLAY` approval token bound to that digest
   (`SKILL_APPROVAL_REQUIRED`; reuse `SKILL_REPLAY_TOKEN_SPENT`; concurrent
   loser `SKILL_CLAIM_CONTESTED`). The claim store is a separate
   `skill-claims.json` the reviewer surface never rewrites.

## Layout

- `computer-mcp.mjs` — the browser worker (stdio JSON-RPC: `initialize`,
  `tools/list`, `tools/call`). Tools: `open_case`, `read_page`,
  `click_button`, `fill_draft_field`, `capture_screenshot`,
  `save_checkpoint`, `request_final_submission`, `capture_url`,
  `start_recording`, `stop_recording`, `list_skills`, `replay_skill`.
- `executor-http.mjs` — HTTP loopback wrapper (shared capture executor):
  `POST /jobs`, `GET /jobs/:jobId/artifacts/:filename` (job_id + filename
  only; traversal rejected). One Chromium, jobs serialized.
- `staging-server.mjs` — human reviewer surface (scrypt login, CSRF,
  single-use digest-bound approval tokens, hash-chained review audit).
  `POST /api/approve-skill` + `POST /api/record-skill-review` issue and
  consume `SKILL_REPLAY` tokens bound to the recomputed skill digest.
- `approval-security.mjs`, `audit.mjs` — token store and audit chain.
- `seal-to-vault.mjs` — seals run screenshots into the Evidence Vault via
  `POST /api/vault/ingest` (`capture_mode: agent_capture`) **only after** a
  consumed reviewer approval.
- `tests/` — unit tests (`npm test`) and the end-to-end proof (`npm run e2e`).
- `ui/` — reviewer login/review pages (from `staging-synthetic/base-reviewer`).

## Run the proof

```bash
cd ..                       # repo root
npm install                 # app deps (see note below)
cd portal-runner
npm install                 # playwright + express
npx playwright install chromium   # or rely on /usr/bin/google-chrome
npm test                    # approval-security unit tests
npm run e2e                 # full proof: app + runner + reviewer + vault
```

The e2e proof writes `evidence/e2e-proof-results.json` with every check and
its verdict. Runtime state (`evidence/`, `data/`, `computer/`, `skills/`) is
gitignored and must never be committed — no logs, browser profiles or
credentials.

## Configuration (env)

| Var | Default | Purpose |
| --- | --- | --- |
| `PORTAL_ORIGIN` | `http://127.0.0.1:4311` | Loopback portal target (guarded) |
| `PORTAL_RUNNER_ASSIGNED_CASES` | `SYN-RC-004` | Comma-separated SYN-* allowlist |
| `PORTAL_RUNNER_DRAFT_FIELDS` | `decision-action,decision-reasons,decision-note` | Fillable draft fields |
| `PORTAL_RUNNER_SAFE_BUTTONS` | `Generate Attorney / AFU Handover Pack` | `\|`-separated safe buttons |
| `PORTAL_RUNNER_CHROME` | `/usr/bin/google-chrome` | Chrome path; falls back to Playwright's bundled Chromium |
| `PORTAL_RUNNER_MODE` | `portal` | `portal` = full portal-run toolset; `capture` = read-only map/address capture (fills/clicks/submits denied) |
| `PORTAL_RUNNER_CAPTURE_ORIGINS` | `https://cdn.kartaview.org,https://tiles.openfreemap.org,http://127.0.0.1:4311` | Exact-origin allowlist for `capture_url` (env config only; remote https, http loopback only) |
| `EXECUTOR_PORT` | `4330` | HTTP wrapper port (loopback) |
| `APP_ORIGIN`, `PORT` | — / `4320` | Reviewer origin/port |
| `REVIEW_ACTION_TYPE`, `REVIEW_CLAIM_REF` | `INTERNAL_SYNTHETIC_REPORT_REVIEW` / `SYN-RC-004` | Reviewable action binding |
| `REVIEW_ACTION_TYPES` | `$REVIEW_ACTION_TYPE` | Comma-separated approvable action types; add `SKILL_REPLAY` to enable skill-replay approvals |
| `SKILLS_DIR` | `<worker>/skills` | Where skill files are written/read (gitignored runtime state) |
| `REVIEWER_DATA_DIR` | `<worker>/data` | Reviewer token store the worker checks for consumed `SKILL_REPLAY` approvals |

## Repo-root install note

At commit `2607629` the committed `package-lock.json` is out of sync with
`package.json` (`npm ci` fails; several entries resolve to local `link:` paths
from the original build environment, and vite 8.4 vs esbuild 0.25 needs
`--legacy-peer-deps` on a fresh resolve). Use
`rm -rf node_modules && npm install --legacy-peer-deps` for a local run. This
is a pre-existing repo issue, not introduced by this module.
