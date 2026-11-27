# Portal Runner / Shared Capture Executor — Integration Contract

**Version 1.0** · against commit `2607629692ba6d5735908826ff437d58ebe6f131`
**Status:** `portal_run` kind fully implemented and e2e-proven; `map_capture`/`address_capture` contract-validated with enforcement hooks (KartaView origins allowlisted below), implementation owned by the integration module.

## 0. Provenance and scope

`computer-mcp.mjs`, `staging-server.mjs`, `approval-security.mjs`, `audit.mjs`,
`review.html`) — ported, not reinvented; behavior-preserving changes are marked
"Change from original" in each file header. Free/open-source only (Playwright,
Apache-2.0; system Chromium). No push, no deploy, no real portals, no real
submissions.

## 1. Shared capture executor

One hosted isolated browser worker owns **exactly one Chromium instance** and
serializes all capture jobs (FIFO, one page at a time), sized for a **512 MB**
service. Both open-map/address capture and portal runs go through this one
executor. Transports:

- **stdio JSON-RPC** (`initialize`, `tools/list`, `tools/call`) — `portal-runner/computer-mcp.mjs`
- **HTTP loopback wrapper** (accepted amendment) — `portal-runner/executor-http.mjs`:
  - `POST /jobs` `{ actions: [{tool, arguments}], stop_on_error? }` → `{ job_id, steps }`
  - `GET /jobs/:jobId/artifacts/:filename` — artifacts retrievable **by job_id + filename only**; names validated (`^[A-Za-z0-9][A-Za-z0-9._-]{0,109}$`, no `..`, `.png|.json|.jsonl` only) and served with an `x-artifact-sha256` header.
  - `GET /health`

### Job envelope (input)

```ts
interface CaptureJob {
  job_id: string;
  kind: 'portal_run' | 'map_capture' | 'address_capture';
  target_url: string;                  // origin must be inside network_policy
  network_policy: { allowed_origins: string[]; allowed_methods: ('GET'|'HEAD')[] };
  case_ref?: string;                   // must match ^SYN-[A-Z0-9-]+$
  viewport?: { width: number; height: number };   // default 1440x1000
  actions?: CaptureAction[];           // typed steps only, see per-kind policy
  requested_by: string;                // actor id, recorded in the audit chain
}
```

Validated by `validateCaptureJob` in `src/lib/engine/captureExecutor.ts`
(unit-tested). Per-kind action policy (`KIND_ACTION_POLICY`):

| Action | portal_run | map_capture / address_capture |
| --- | --- | --- |
| `open_case`, `read_page`, `save_checkpoint`, `screenshot` (optional `selector`) | yes | yes |
| `fill_draft_field` (allowlisted fields), `click_safe_button` (allowlisted buttons) | yes | **no** |
| `request_final_submission` | yes (always holds) | **no** |

### Result envelope (output)

```ts
interface CaptureResult {
  job_id: string;
  status: 'completed' | 'awaiting_human_approval' | 'denied' | 'failed';
  screenshots: { filename: string; sha256: string; byte_size: number; captured_at: string }[];
  filled_fields_digest: string | null; // sha256 of canonical filled-field JSON
  submitted: false;                    // ALWAYS false
  denial_reason: string | null;
  audit_head_hash: string;             // head of the sha256-chained audit log
}
```

### Network policy enforcement (executor-enforced)

- `portal_run`: every origin **and** the target must be plain-http loopback
  (`127.0.0.1`/`localhost`); anything else throws `PORTAL_URL_DENIED`.
- `map_capture` / `address_capture`: exact origins allowlisted **by the
  operator/job config after a server-side metadata fetch** — never from page
  metadata or arbitrary browser URL input. Accepted allowlist from the
  integration owner: `https://cdn.kartaview.org` (rendered images),
  `https://api.kartaview.org` (read-only metadata, queried server-side in the
  integration module). GET/HEAD only. **No Google screenshot automation** in
  the shared runner.
- Runtime: request interception aborts off-policy requests (`network-denied`)
  and all non-GET/HEAD methods (`write-denied`), both logged to the audit
  chain.

### capture_url tool (implemented + proven 2026-11-27)

`capture_url {url, name?, wait_ms?}` performs a read-only capture of a
server-selected map/address URL through the same single Chromium. The URL's
origin must string-match the **trusted env-configured exact-origin allowlist**
(`PORTAL_RUNNER_CAPTURE_ORIGINS`, default `https://cdn.kartaview.org`,
`https://tiles.openfreemap.org`, `http://127.0.0.1:4311` — remote origins
https-only, http for loopback only). Requester-supplied origins get
`CAPTURE_ORIGIN_DENIED`; the request interceptor still enforces GET/HEAD only
(`write-denied`/`network-denied` logged). In `PORTAL_RUNNER_MODE=capture`
(add-address/map mode) every fill/click/submit/open-case action is denied
with `CAPTURE_MODE_READ_ONLY`. Returns the SHA-256-hashed screenshot plus a
provenance sidecar `<name>.json` (`source_url`, `final_url`, `http_status`,
`captured_at`, watermark text and whether it rendered). An
`ADVISORY — UNVERIFIED VISUAL RECORD` banner with URL and timestamp is
injected on HTML pages (visually verified); raw image bytes cannot be
overlaid in-browser, which the sidecar records as `watermark_rendered:
false`. Artifact membership/existence checks on the HTTP wrapper are owned by
the integration owner.

### Image-capture provenance (map/address)

Every map/address screenshot record carries: `source_url`, `captured_at`,
`author`, `licence`, `distance_m_from_requested`
(`IMAGE_CAPTURE_REQUIRED_METADATA`) and the watermark text
`ADVISORY — UNVERIFIED VISUAL RECORD` (`IMAGE_CAPTURE_WATERMARK`). Original
image bytes are preserved unchanged with attribution; the Vault links the
original bytes (binary SHA-256 in `attachment_meta.binary_sha256`) to the
sealed metadata hash. Provider lookups happen server-side in the integration
module, never from arbitrary browser URL input.

## 2. Portal run flow (implemented + proven)

1. `open_case {case_id}` — must be on the assigned SYN-* allowlist
   (`PORTAL_RUNNER_ASSIGNED_CASES`, default `SYN-RC-004`), else
   `WRONG_CASE_DENIED`. Navigates the loopback portal to the case.
2. `read_page` — visible case text.
3. `fill_draft_field {field, value}` — allowlisted draft fields only
   (`decision-action`, `decision-reasons`, `decision-note`), max 2500 chars,
   persisted locally, never submitted.
4. `click_button {name}` — allowlisted safe preview buttons only (default
   `Generate Attorney / AFU Handover Pack`).
5. `capture_screenshot {name?, selector?}` / `save_checkpoint` — PNG +
   SHA-256 + checkpoint JSON (`status: WAITING_HUMAN_APPROVAL`, field digest).
6. `request_final_submission` — **terminal hold**: returns
   `HUMAN_APPROVAL_REQUIRED`, `submitted: false`, `audit_head_hash`. No code
   path performs a submit.

### Record-and-replay skills (implemented + proven 2026-11-27)

An insurer demonstrates a flow once ("watch me capture FNOL across the portal");
the exact clicks and fills are saved as a reusable skill. A skill is **data,
never a script**: a JSON file in `SKILLS_DIR` (gitignored runtime state) with a
step list (`goto` portal-relative path, `click_text`, `click_button`, `fill`,
`screenshot`) and `steps_digest` = SHA-256 over the canonical step JSON.

- `start_recording` / `stop_recording {name}` — record demonstrated
  input/change/click events on the portal (via an injected listener +
  host binding), normalize them (consecutive fills on one selector collapse
  to the final value), prepend the case-navigation steps, and write the
  digest-sealed skill file. Skill ids must match
  `^[A-Za-z0-9][A-Za-z0-9-]{0,60}$`.
- **Auto-save**: every successful `save_checkpoint` also writes
  `auto-<case>-<digest8>` from the exact tool calls of that session.
- `list_skills` — id, creator (`recorded`/`auto`), step count, digest.
- `replay_skill {skill_id, approval_token}` — **approval-bound, one execution
  per approval**. Gates in order: `SKILL_ID_DENIED`, `SKILL_NOT_FOUND`,
  `SKILL_DIGEST_MISMATCH` (digest recomputed from the file, never trusted),
  then a **static allowlist pass** over every step (`SKILL_STEP_DENIED`):
  `goto` only to the synthetic recovery page `/recovery` on `PORTAL_ORIGIN`;
  `click_text` only an assigned `SYN-*` case ref; `click_button` only a
  registered safe preview button (`PORTAL_RUNNER_SAFE_BUTTONS`); `fill` only
  a registered draft field (`PORTAL_RUNNER_DRAFT_FIELDS`). This is an
  allowlist, not a submit-word blacklist. Then the **atomic one-execution
  claim**: under an mkdir lock (atomic across worker processes; a stale lock
  from a crash is broken once after 60 s) the worker validates the consumed,
  unexpired `SKILL_REPLAY` token (type + claim_ref + recomputed digest) and
  records the token hash in a separate `skill-claims.json` store the reviewer
  surface never rewrites. Reuse is denied (`SKILL_REPLAY_TOKEN_SPENT`); a
  concurrent loser is denied (`SKILL_CLAIM_CONTESTED` or
  `SKILL_REPLAY_TOKEN_SPENT`). The static pass runs before the claim, so a
  denied skill never spends its approval. Returns `REPLAY_COMPLETED`,
  `submitted: false`, the per-step and final screenshots (SHA-256-hashed),
  and `audit_head_hash`. Every replay step is appended to the hash-chained
  audit log.

Skill-replay approval uses the same reviewer surface and token store as §3:
`POST /api/approve-skill {skill_id}` recomputes the digest from the skill file
(refusing `SKILL_DIGEST_MISMATCH` before any token exists) and issues a
single-use 5-minute token bound to `{type: SKILL_REPLAY, claim_ref, digest}`;
`POST /api/record-skill-review {token, skill_id}` consumes it (principal must
match the issuer). `SKILL_REPLAY` must be listed in the reviewer surface's
`REVIEW_ACTION_TYPES` env (default list contains only
`INTERNAL_SYNTHETIC_REPORT_REVIEW`).

## 3. Human approval (required before any Vault seal)

`portal-runner/staging-server.mjs` + `approval-security.mjs` (ported):
enrolled reviewer only (scrypt + timing-safe compare, rate-limited login),
HttpOnly SameSite=Strict session, Origin + CSRF enforcement, hash-chained
review audit. `POST /api/approve` issues a **single-use, 5-minute token bound
to action type + claim_ref + report digest**; `POST /api/record-review`
consumes it (replay/tamper/other-claim denied; `external_action: false`
always). The approvable action types stay internal
(`INTERNAL_SYNTHETIC_REPORT_REVIEW` by default; `SKILL_REPLAY` for
skill-replay approvals when enabled via `REVIEW_ACTION_TYPES`, see §2).
Skill-replay executions are claimed exactly once per token in a separate
`skill-claims.json` store next to the token store (the reviewer surface never
rewrites it, so its wholesale saves cannot clobber a claim).
**Real authentication stays separate from the demo role selector** — the reviewer credential is a local
synthetic enrolment for the demo; production auth is out of scope here.

### 3.1 Reviewer session-check interface (exact, for address/messaging modules)

```js
// CONSTRUCTOR
new ApprovalSecurity(filePath, options?)
//   filePath: JSON state file (atomic tmp+rename writes, mode 0600)
//   options: { allowedActionTypes?: string[], allowedClaimRefs?: string[] }
//   instance.state = { sessions: {}, tokens: {}, decisions: [] }
//   (sessions keyed by sha256(secret); tokens keyed by sha256(token))

// LOGIN — credential record at DATA_DIR/reviewer-credential.json:
//   { username, principal, role, salt, password_hash: scryptSync(pw, salt, 64).hex }
//   role: one of APPROVAL_ROLES = ['investigator', 'reviewer', 'admin', 'CFO']
security.login(username, password, credential)
//   -> { secret, csrf, principal, role }
//   throws REVIEWER_NOT_ENROLLED | INVALID_LOGIN (scrypt + timingSafeEqual)
//   throws CREDENTIAL_ROLE_INVALID when the credential role is missing/unknown
//   secret: 32 random bytes base64url; csrf: 24 random bytes base64url; 30-min expiry

// SESSION CHECK — the one interface routes use:
security.session(secret)
//   -> { principal, role, csrf, expires }
//   throws AUTH_REQUIRED when missing/expired.
```

**Role authority:** `session()` returns `{principal, role}` where role is read
ONLY from the server-side enrolled credential record
(`reviewer-credential.json`, `APPROVAL_ROLES` allowlist). It is never taken
from client headers or request bodies, and login fails closed
(`CREDENTIAL_ROLE_INVALID`) when the enrolled role is missing or unknown. The
role persists in the session store across restarts. `GET /api/state` exposes
the session role to the authenticated UI. The integration owner builds the
single host guard that populates `req.reviewer` (via `security.session`) for
the messaging, scheduler and address modules.

**Cookie handling (server side):** issued on `POST /login` success as
`Set-Cookie: reviewer=<secret>; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`
(`; Secure` appended when `APP_ORIGIN` is https). Read per request by parsing
`req.headers.cookie` for the `reviewer=` value (4-line `secret(req)` helper in
`staging-server.mjs`; no cookie-parser dependency).

**Route guard pattern (express middleware, mounted after `/health` and `/login`):**

```js
app.use((req, res, next) => {
  try { req.reviewer = security.session(secret(req)); next(); }
  catch {
    if (req.method === 'GET' && req.path === '/') return res.redirect('/login');
    res.status(401).json({ error: 'AUTH_REQUIRED' });
  }
});
// routes then read req.reviewer.principal (id) and req.reviewer.csrf
```

**CSRF + Origin (all state-changing routes):** the UI obtains its per-session
csrf from authenticated `GET /api/state`. State-changing POSTs must carry
`x-csrf-token` equal to the session csrf AND an `Origin` header equal to
`APP_ORIGIN`; failures are `ORIGIN_DENIED` / `ORIGIN_OR_CSRF_DENIED` /
`CSRF_DENIED`. `POST /login` additionally enforces Origin and a
5-per-15-minute per-IP rate limit (`429 RATE_LIMIT`).

**Approval tokens (the seal gate):**
`security.approve(secret, csrf, action) -> token` (single-use, 5-min, bound to
`{type, claim_ref, digest}`; `ACTION_NOT_PERMITTED` off-allowlist);
`security.consume(token, action) -> { principal, internal_review_only: true,
external_action: false }` (`TOKEN_INVALID_EXPIRED_OR_USED` on replay/expiry,
`TOKEN_ACTION_MISMATCH` on tampering).

## 4. Evidence Vault sealing

**Gate:** `portal-runner/seal-to-vault.mjs` refuses (`REVIEWER_APPROVAL_REQUIRED`)
unless the reviewer state contains a **consumed** approval token bound to the
exact run-report digest and case ref.

**Live path (per screenshot):** `POST /api/vault/ingest` on the NahaShield
server with `content_base64` (original PNG bytes), `mime_type: image/png`,
`capture_mode: agent_capture` (new union member added by this patch in
`src/lib/engine/evidenceIngestion.ts` + `server.ts`),
`evidence_tag: Verified Fact`, `case_ref`, title, note. The server verifies
PNG magic bytes, records `attachment_meta.binary_sha256` (original bytes ↔
metadata link), appends via `store.appendEvidence` (server computes
`sha256_content` and the `prev_chain_hash` → `chain_hash` link), and returns
the full-chain `verifyEvidenceChain` result. Source adapter recorded as
`Synthetic Portal Runner Capture (…)`; every sealed summary embeds the repo's
`DATED_VISUAL_RECORD_DISCLAIMER` and a synthetic-only marker.

**Offline path (contract tests, no server):**
`sealPortalRunEvidence` in `src/lib/engine/portalRunner.ts` builds identical
`EvidenceItemRecord[]` chained with `computeChainHash` from
`src/lib/engine/vault.ts`.

## 5. Proven vs specified (nothing claimed unproven)

**Proven 2026-11-27 in the build sandbox (latest run: verdict
`E2E_PROOF_PASSED`, 54/54 checks, artifacts in
`portal-runner/evidence/e2e-proof-results.json`):**

- Repo suite `npm test`: 44/44 pass (incl. 12 new contract/vault tests);
  `npm run lint` (`tsc --noEmit`) clean; `portal-runner` unit tests 3/3.
- Live loopback run against the real app: wrong case denied; case opened and
  read; forbidden button (`Record Signed Human Decision`) and forbidden field
  (`reviewer`) denied; draft filled (visually verified in the checkpoint
  screenshot); safe preview opened; checkpoint `WAITING_HUMAN_APPROVAL`;
  final submission held; app decisions and evidence counts unchanged; zero
  write-denials triggered; audit chain valid.
- Approval gate: forged/unconsumed token refused; synthetic reviewer login →
  approve → record-review succeeded with `external_action: false`.
- Vault: 2 screenshots sealed, chain valid, original bytes match sealed
  hashes, live `POST /api/vault/verify` valid, vault grew exactly by the
  sealed items.

**Also proven (patch 2):** capture mode denies fill/click/submit
(`CAPTURE_MODE_READ_ONLY`); requester-supplied origin denied
(`CAPTURE_ORIGIN_DENIED`); allowlisted loopback capture returned a real PNG
(visually verified, watermark banner rendered) with matching SHA-256 and a
provenance sidecar; repo suite 45/45 at that patch.

**Also proven (patch 3, record-and-replay skills; repo suite 51/51 at that
patch, e2e 46/46):** a demonstrated FNOL flow recorded into a digest-sealed skill;
auto-save on checkpoint (`auto-syn-rc-004-*`); skills listed; replay without
approval denied (`SKILL_APPROVAL_REQUIRED`); a tampered skill file denied by
digest recompute on both the worker (`SKILL_DIGEST_MISMATCH`) and the
reviewer surface (approval refused before token issue); reviewer
`approve-skill` + `record-skill-review` issued and consumed a digest-bound
`SKILL_REPLAY` token; the approved replay ran the exact saved steps and
returned `REPLAY_COMPLETED` with `submitted: false` and hashed screenshots
(final replay screenshot visually verified: SYN-RC-004 selected, handover
pack preview open, decision unsubmitted); a hostile skill with a *correct*
digest **and** a valid approval was still denied at its submit-like step
(`SKILL_STEP_DENIED`); app decisions unchanged after all replays.

**Also proven (patch 4, skills hardening; repo suite 52/52, portal-runner
units 6/6, e2e 54/54):** an approved replay token replays exactly once —
immediate reuse is denied (`SKILL_REPLAY_TOKEN_SPENT`); two worker processes
racing one fresh token produce exactly one `REPLAY_COMPLETED` and one denial
(`SKILL_CLAIM_CONTESTED`); replay steps are restricted to the registered
allowlists (a `#reviewer` fill and an unregistered button denied even with
correct digest and valid approval); recorded navigation outside the
synthetic recovery page (`/admin`) is denied; a statically denied skill never
spends its approval token (claims store verified); auto-save still works
(`auto-syn-rc-004-*`); final replay screenshot visually verified again.

**Specified, not yet e2e-proven:** live KartaView fetches (sandbox proof used
the allowlisted loopback preview; the CDN/tile origins follow the identical
enforced code path); author/licence/distance metadata attachment (server-side
in the integration module); HTTP wrapper artifact membership fix (owned by
the integration owner) and soak under concurrent job load; deployment on a
real 512 MB host.

## 6. Known pre-existing repo issues at this commit (not introduced here)

- `package-lock.json` is out of sync with `package.json` (`npm ci` fails;
  several entries are `link:` paths to the original build machine; fresh
  resolve needs `--legacy-peer-deps` for the vite 8.4 / esbuild 0.25 peer
  pair). Local run: `rm -rf node_modules && npm install --legacy-peer-deps`.
- `staging-synthetic/README.md` carries deploy/secret directives from its own
  workspace; this module deploys nothing and follows none of them.
