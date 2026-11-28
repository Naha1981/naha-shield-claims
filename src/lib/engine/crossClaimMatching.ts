// Cross-claim duplicate matching engine. Sample data only.
// Built to Thabiso's spec 3 (TC-DUP-001 to 050, WhatsApp 07:09). Where the
// earlier specs' numbers conflicted, the stricter value was kept:
//   bank account 92 (spec 2 payload said 88), agent duplicate policy 85 (was 82),
//   cross-insurer 97 (spec 3 said 95), address/phone/device signals require
//   human review per spec 3 (spec 1 said monitor without review).
// Fairness controls follow spec 3's innocent-control and fairness sections.
// The engine only recommends. It never holds, declines or refers by itself.

export type MatchAction =
  | 'no_action'
  | 'monitor_only'
  | 'request_call_back'
  | 'request_verification'
  | 'investigate'
  | 'hold_and_investigate'
  | 'agent_review'
  | 'provider_review'
  | 'human_review'
  | 'cross_market_referral';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ClaimFacts {
  tenant_id: string;
  claim_id: string;
  policy_id?: string;
  status?: string; // e.g. 'flagged'
  insured_person?: { id_number_hash?: string; full_name?: string; date_of_birth?: string };
  claimant?: { id_number_hash?: string; phone_hash?: string };
  beneficiaries?: { id_number_hash?: string }[];
  bank_account_token?: string;
  device_fingerprint?: string;
  address_hash?: string;
  address_context?: 'rural' | 'informal_settlement';
  agent_id?: string;
  funeral_parlour_id?: string;
  doctor_id?: string;
  document?: { sha256_hash?: string; perceptual_hash?: string };
  policy_issued_at?: string;
  cover_increase_at?: string;
  claim_submitted_at?: string;
  id_transposition_detected?: boolean;
  language?: string;
  consent_id?: string;
  consent_withdrawn?: boolean;
  context?: {
    shared_household?: boolean;
    family_phone?: boolean;
    family_account?: boolean;
    high_volume_agent?: boolean;
    high_volume_parlour?: boolean;
  };
}

export interface DuplicateMatch {
  match_type: string;
  matched_fields: string[];
  match_confidence: number;
  score: number;
  risk_level: RiskLevel;
  matched_claim_id?: string;
  matched_policy_id?: string;
  matched_insurer?: string;
  recommended_action: MatchAction;
  human_review_required: boolean;
  innocent_explanations: string[];
}

export interface DuplicateCheckResult {
  check_id: string;
  check_status: 'completed' | 'queued' | 'not_run';
  error?: { status: 400 | 403; code: string; field?: string };
  matches: DuplicateMatch[];
  total_matches: number;
  paginated: boolean;
  duplicate_risk_score: number;
  risk_level: RiskLevel;
  recommended_action: MatchAction;
  human_review_required: boolean;
  innocent_explanations: string[];
  appeal_available: true;
  automatic_adverse_action: false;
  accusation_wording: false;
  claimant_language?: string;
  graph_depth: number;
  audit_event: { type: string; tenant_id: string; claim_id: string; matches: number; score: number };
}

export interface DuplicateCheckOptions {
  cross_insurer_signals?: { insurer: string; claim_pattern: string; match_confidence: number }[];
  cross_insurer_timeout?: boolean;
  requesting_tenant?: string;
  require_consent?: boolean;
  max_matches?: number; // default 20; more than this paginates (TC-DUP-037)
  graph_depth?: number; // default 2, configurable (TC-DUP-049)
}

interface MatchDef {
  confidence: number;
  score: number;
  level: RiskLevel;
  action: MatchAction;
  review: boolean;
  explanations: string[];
}

// One row per spec-3 match type: confidence, score, level, action, review, innocent explanations.
const DEFS: Record<string, MatchDef> = {
  same_deceased: { confidence: 0.99, score: 95, level: 'high', action: 'hold_and_investigate', review: true, explanations: ['Possible duplicate policy held by the same family.'] },
  same_deceased_policy: { confidence: 0.98, score: 90, level: 'high', action: 'hold_and_investigate', review: true, explanations: ['Possible duplicate policy held by the same family.'] },
  same_claimant_multiple_claims: { confidence: 0.95, score: 80, level: 'high', action: 'investigate', review: true, explanations: ['A claimant may legitimately claim on more than one policy.'] },
  same_beneficiary_multiple_claims: { confidence: 0.94, score: 78, level: 'high', action: 'investigate', review: true, explanations: ['A beneficiary may be named on more than one policy.'] },
  same_bank_account_multiple_claims: { confidence: 0.97, score: 92, level: 'high', action: 'hold_and_investigate', review: true, explanations: ['Family members may share a bank account.'] },
  fuzzy_name_exact_id: { confidence: 0.96, score: 88, level: 'high', action: 'hold_and_investigate', review: true, explanations: ['Name spellings may differ on capture.'] },
  similar_name_different_id: { confidence: 0.35, score: 25, level: 'low', action: 'monitor_only', review: false, explanations: ['Different people may share the same name.'] },
  same_surname_only: { confidence: 0.2, score: 10, level: 'low', action: 'no_action', review: false, explanations: ['Different people may share the same surname.'] },
  possible_id_transposition: { confidence: 0.7, score: 60, level: 'medium', action: 'request_verification', review: true, explanations: ['ID numbers may be captured with a typing error.'] },
  same_phone_multiple_claims: { confidence: 0.8, score: 65, level: 'medium', action: 'request_call_back', review: true, explanations: ['Family members may share a phone number.'] },
  shared_family_phone: { confidence: 0.55, score: 35, level: 'low', action: 'monitor_only', review: true, explanations: ['Family members may share a phone number.'] },
  same_agent_duplicate_policy: { confidence: 0.93, score: 85, level: 'high', action: 'agent_review', review: true, explanations: ['A productive agent may write many legitimate policies.'] },
  high_volume_agent: { confidence: 0.4, score: 25, level: 'low', action: 'monitor_only', review: false, explanations: ['A productive agent may write many legitimate policies.'] },
  shared_funeral_parlour: { confidence: 0.72, score: 60, level: 'medium', action: 'provider_review', review: true, explanations: ['Busy parlour may naturally process many claims.'] },
  shared_certifying_doctor: { confidence: 0.7, score: 58, level: 'medium', action: 'provider_review', review: true, explanations: ['A doctor may certify many legitimate claims.'] },
  high_volume_parlour: { confidence: 0.35, score: 20, level: 'low', action: 'monitor_only', review: false, explanations: ['High-volume parlour may process many legitimate claims.'] },
  same_device_multiple_claims: { confidence: 0.78, score: 65, level: 'medium', action: 'request_call_back', review: true, explanations: ['Shared household device.'] },
  shared_household_device: { confidence: 0.5, score: 35, level: 'low', action: 'monitor_only', review: true, explanations: ['Shared household device.'] },
  same_address_multiple_claims: { confidence: 0.65, score: 50, level: 'medium', action: 'monitor_only', review: true, explanations: ['Shared household address.'] },
  same_household_address: { confidence: 0.45, score: 30, level: 'low', action: 'monitor_only', review: true, explanations: ['Family members may live at the same address.'] },
  rural_address_only: { confidence: 0.2, score: 10, level: 'low', action: 'no_action', review: false, explanations: ['Rural addresses are often shared by many households.'] },
  informal_settlement_address_only: { confidence: 0.2, score: 10, level: 'low', action: 'no_action', review: false, explanations: ['Informal settlement addresses are often shared by many households.'] },
  shared_family_bank_account: { confidence: 0.6, score: 55, level: 'medium', action: 'request_call_back', review: true, explanations: ['Family members may share a bank account.'] },
  early_claim_after_issue: { confidence: 0.85, score: 78, level: 'high', action: 'investigate', review: true, explanations: ['A death can happen shortly after a policy starts, without anything being wrong.'] },
  claim_after_cover_increase: { confidence: 0.88, score: 82, level: 'high', action: 'investigate', review: true, explanations: ['Cover increases can coincide with a claim by chance.'] },
  same_document_hash: { confidence: 0.97, score: 90, level: 'high', action: 'hold_and_investigate', review: true, explanations: ['The same document may be uploaded twice by mistake.'] },
  same_document_perceptual_hash: { confidence: 0.88, score: 82, level: 'high', action: 'hold_and_investigate', review: true, explanations: ['Similar-looking documents may be scans of one original.'] },
  cross_insurer_duplicate_claim: { confidence: 0.96, score: 97, level: 'high', action: 'cross_market_referral', review: true, explanations: ['A family may hold cover with more than one insurer.'] },
  // Spec 4 TC-FUZZ additions: weak standalone signals the spec 3 table did not cover.
  same_dob_only: { confidence: 0.25, score: 12, level: 'low', action: 'no_action', review: false, explanations: ['Many people share a date of birth.'] },
  same_agent_only: { confidence: 0.45, score: 45, level: 'medium', action: 'monitor_only', review: true, explanations: ['A productive agent may write many legitimate policies.'] },
};

const ACTION_SEVERITY: MatchAction[] = [
  'no_action', 'monitor_only', 'human_review', 'request_call_back', 'request_verification',
  'investigate', 'provider_review', 'agent_review', 'cross_market_referral', 'hold_and_investigate',
];
const LEVEL_SEVERITY: RiskLevel[] = ['low', 'medium', 'high'];

// Score-threshold boundaries (TC-DUP-032 to 035): 85 hold/high, 70 call-back/medium, below 70 monitor/low.
export function classifyScore(score: number): { risk_level: RiskLevel; recommended_action: MatchAction; human_review_required: boolean } {
  if (score >= 85) return { risk_level: 'high', recommended_action: 'hold_and_investigate', human_review_required: true };
  if (score >= 70) return { risk_level: 'medium', recommended_action: 'request_call_back', human_review_required: true };
  return { risk_level: 'low', recommended_action: 'monitor_only', human_review_required: false };
}

const HASH_RE = /^[A-Za-z0-9_:\-]{8,128}$/;

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= n; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[n];
}

// Trigram similarity mirroring PostgreSQL pg_trgm similarity(): share of
// three-character trigrams two strings have in common. The SQL tuning in
// docs/claims-workspace-schema.sql uses the same operator for candidate search.
export function trigramSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const padded = `  ${s.toLowerCase()} `;
    const set = new Set<string>();
    for (let i = 0; i + 3 <= padded.length; i++) set.add(padded.slice(i, i + 3));
    return set;
  };
  const ga = grams(a), gb = grams(b);
  if (ga.size === 0 && gb.size === 0) return 1;
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  return shared / (ga.size + gb.size - shared);
}

function surname(name?: string): string | undefined {
  const parts = (name ?? '').trim().toLowerCase().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : undefined;
}

export function runDuplicateCheck(claim: ClaimFacts, all: ClaimFacts[], opts: DuplicateCheckOptions = {}): DuplicateCheckResult {
  const maxMatches = opts.max_matches ?? 20;
  const graphDepth = opts.graph_depth ?? 2;
  const checkId = `dup_${claim.tenant_id}_${claim.claim_id}`;

  const base: DuplicateCheckResult = {
    check_id: checkId,
    check_status: 'completed',
    matches: [],
    total_matches: 0,
    paginated: false,
    duplicate_risk_score: 0,
    risk_level: 'low',
    recommended_action: 'no_action',
    human_review_required: false,
    innocent_explanations: [],
    appeal_available: true,
    automatic_adverse_action: false,
    accusation_wording: false,
    claimant_language: claim.language,
    graph_depth: graphDepth,
    audit_event: { type: 'duplicate_check_completed', tenant_id: claim.tenant_id, claim_id: claim.claim_id, matches: 0, score: 0 },
  };

  const blocked = (status: 400 | 403, code: string, field?: string): DuplicateCheckResult => ({
    ...base,
    check_status: 'not_run',
    error: { status, code, field },
    audit_event: { ...base.audit_event, type: 'duplicate_check_blocked' },
  });

  // Negative controls (TC-DUP-027 to 030, 041)
  if (opts.requesting_tenant && opts.requesting_tenant !== claim.tenant_id) return blocked(403, 'TENANT_ACCESS_DENIED');
  // TC-DUP-027: a claim with no identifying data at all is invalid. Behavioural
  // signals alone (timestamps, providers) are still checkable, per spec 3's own inputs.
  const hasSignal = claim.insured_person || claim.claimant || claim.bank_account_token || claim.device_fingerprint || claim.address_hash
    || claim.agent_id || claim.funeral_parlour_id || claim.doctor_id || claim.document
    || (claim.beneficiaries?.length ?? 0) > 0 || claim.policy_issued_at || claim.cover_increase_at;
  if (!hasSignal) return blocked(400, 'VALIDATION_ERROR', 'insured_person');
  if (claim.insured_person?.id_number_hash !== undefined && !HASH_RE.test(claim.insured_person.id_number_hash)) return blocked(400, 'INVALID_IDENTIFIER');
  if (opts.require_consent && !claim.consent_id && !claim.consent_withdrawn) return blocked(403, 'CONSENT_REQUIRED');
  if (claim.consent_withdrawn) return blocked(403, 'CONSENT_WITHDRAWN');

  // Cross-insurer timeout (TC-DUP-050): queue and retry with backoff upstream.
  if (opts.cross_insurer_timeout) {
    return { ...base, check_status: 'queued', audit_event: { ...base.audit_event, type: 'duplicate_check_queued' } };
  }

  const others = all.filter((o) => o.tenant_id === claim.tenant_id && o.claim_id !== claim.claim_id);
  const matches: DuplicateMatch[] = [];
  const add = (type: string, fields: string[], other?: ClaimFacts, extra?: Partial<DuplicateMatch>) => {
    if (matches.some((m) => m.match_type === type)) return;
    const def = DEFS[type];
    matches.push({
      match_type: type,
      matched_fields: fields,
      match_confidence: def.confidence,
      score: def.score,
      risk_level: def.level,
      matched_claim_id: other?.claim_id,
      matched_policy_id: other?.policy_id,
      recommended_action: def.action,
      human_review_required: def.review,
      innocent_explanations: [...def.explanations],
      ...extra,
    });
  };
  const first = (pred: (o: ClaimFacts) => boolean) => others.find(pred);

  const deceasedHash = claim.insured_person?.id_number_hash;
  const deceasedName = claim.insured_person?.full_name?.toLowerCase();
  const deceasedDob = claim.insured_person?.date_of_birth;
  const claimantHash = claim.claimant?.id_number_hash;
  const claimantDiffers = (o: ClaimFacts) =>
    claimantHash && o.claimant?.id_number_hash ? o.claimant.id_number_hash !== claimantHash
    : deceasedHash && o.insured_person?.id_number_hash ? o.insured_person.id_number_hash !== deceasedHash
    : true;

  let hit: ClaimFacts | undefined;

  // Exact identity (TC-DUP-001, 002, 006)
  if (deceasedHash && (hit = first((o) => o.insured_person?.id_number_hash === deceasedHash))) {
    const otherName = hit.insured_person?.full_name?.toLowerCase();
    const otherDob = hit.insured_person?.date_of_birth;
    const similarName = deceasedName && otherName && deceasedName !== otherName
      && (levenshtein(deceasedName, otherName) <= 2 || trigramSimilarity(deceasedName, otherName) >= 0.3);
    if (similarName && deceasedDob && deceasedDob === otherDob) {
      add('fuzzy_name_exact_id', ['full_name', 'date_of_birth', 'id_number_hash'], hit);
    } else if (hit.policy_id && claim.policy_id && hit.policy_id !== claim.policy_id) {
      add('same_deceased_policy', ['id_number_hash'], hit);
    } else {
      add('same_deceased', ['id_number_hash'], hit);
    }
  }

  // Fuzzy name, different ID (TC-DUP-007, 008)
  if (deceasedName && (hit = first((o) => {
    const on = o.insured_person?.full_name?.toLowerCase();
    return !!on && o.insured_person?.id_number_hash !== deceasedHash && levenshtein(deceasedName, on) <= 1;
  }))) {
    add('similar_name_different_id', ['full_name'], hit);
  } else if (deceasedName && (hit = first((o) => {
    const on = o.insured_person?.full_name;
    return !!on && o.insured_person?.id_number_hash !== deceasedHash
      && surname(on) === surname(deceasedName)
      && on.trim().toLowerCase() !== deceasedName.trim().toLowerCase();
  }))) {
    add('same_surname_only', ['surname'], hit);
  }

  // Same date of birth only (spec 4 TC-FUZZ-005): too weak to act on alone.
  if (deceasedDob
    && !matches.some((m) => ['fuzzy_name_exact_id', 'similar_name_different_id', 'same_surname_only', 'same_deceased', 'same_deceased_policy'].includes(m.match_type))
    && (hit = first((o) => o.insured_person?.date_of_birth === deceasedDob
      && o.insured_person?.id_number_hash !== undefined && o.insured_person?.id_number_hash !== deceasedHash
      && (!deceasedName || !o.insured_person?.full_name || o.insured_person.full_name.toLowerCase() !== deceasedName)))) {
    add('same_dob_only', ['date_of_birth'], hit);
  }

  // Same agent across unrelated claims (spec 4 TC-FUZZ-010): weak on its own.
  if (claim.agent_id
    && !matches.some((m) => m.match_type === 'same_agent_duplicate_policy' || m.match_type === 'high_volume_agent')
    && (hit = first((o) => o.agent_id === claim.agent_id
      && (!deceasedHash || (o.insured_person?.id_number_hash !== undefined && o.insured_person?.id_number_hash !== deceasedHash))))) {
    add('same_agent_only', ['agent_id'], hit);
  }

  // Claimant and beneficiary (TC-DUP-003, 004)
  if (claimantHash && (hit = first((o) => o.claimant?.id_number_hash === claimantHash && o.insured_person?.id_number_hash !== deceasedHash))) {
    add('same_claimant_multiple_claims', ['claimant_id_hash'], hit);
  }
  const benHashes = (claim.beneficiaries ?? []).map((b) => b.id_number_hash).filter(Boolean) as string[];
  if (benHashes.length && (hit = first((o) => (o.beneficiaries ?? []).some((b) => b.id_number_hash && benHashes.includes(b.id_number_hash)) && o.insured_person?.id_number_hash !== deceasedHash))) {
    add('same_beneficiary_multiple_claims', ['beneficiary_id_hash'], hit);
  }

  // Bank account (TC-DUP-005, 024)
  if (claim.bank_account_token && (hit = first((o) => o.bank_account_token === claim.bank_account_token && claimantDiffers(o)))) {
    add(claim.context?.family_account ? 'shared_family_bank_account' : 'same_bank_account_multiple_claims', ['bank_account_token'], hit);
  }

  // ID transposition (TC-DUP-009)
  if (claim.id_transposition_detected && (hit = first(() => true))) {
    add('possible_id_transposition', ['id_number_hash'], hit);
  }

  // Phone (TC-DUP-010, 023, 045)
  if (claim.claimant?.phone_hash && (hit = first((o) => o.claimant?.phone_hash === claim.claimant?.phone_hash && claimantDiffers(o)))) {
    add(claim.context?.family_phone ? 'shared_family_phone' : 'same_phone_multiple_claims', ['phone_hash'], hit);
  }

  // Agent (TC-DUP-011, 026)
  if (claim.agent_id && (hit = first((o) => o.agent_id === claim.agent_id && o.insured_person?.id_number_hash === deceasedHash && !!deceasedHash && o.policy_id !== claim.policy_id))) {
    add(claim.context?.high_volume_agent ? 'high_volume_agent' : 'same_agent_duplicate_policy', ['agent_id'], hit);
  }

  // Providers (TC-DUP-012, 013, 025)
  if (claim.funeral_parlour_id && (hit = first((o) => o.funeral_parlour_id === claim.funeral_parlour_id))) {
    if (claim.context?.high_volume_parlour) add('high_volume_parlour', ['funeral_parlour_id'], hit);
    else if (hit.status === 'flagged' || matches.length > 0) add('shared_funeral_parlour', ['funeral_parlour_id'], hit);
    else add('high_volume_parlour', ['funeral_parlour_id'], hit);
  }
  if (claim.doctor_id && (hit = first((o) => o.doctor_id === claim.doctor_id))) {
    if (hit.status === 'flagged' || matches.length > 0) {
      add('shared_certifying_doctor', ['doctor_id'], hit);
    } else if (!matches.some((m) => m.match_type === 'shared_certifying_doctor')) {
      // Doctor overlap with no other signal: low, monitor only (judgment call; spec 3 defines no plain-doctor case).
      matches.push({
        match_type: 'shared_certifying_doctor',
        matched_fields: ['doctor_id'],
        match_confidence: 0.35,
        score: 20,
        risk_level: 'low',
        matched_claim_id: hit.claim_id,
        matched_policy_id: hit.policy_id,
        recommended_action: 'monitor_only',
        human_review_required: false,
        innocent_explanations: ['A doctor may certify many legitimate claims.'],
      });
    }
  }

  // Device (TC-DUP-014, 044)
  if (claim.device_fingerprint && (hit = first((o) => o.device_fingerprint === claim.device_fingerprint && claimantDiffers(o)))) {
    add(claim.context?.shared_household ? 'shared_household_device' : 'same_device_multiple_claims', ['device_fingerprint'], hit);
  }

  // Timing (TC-DUP-016, 017)
  if (claim.policy_issued_at && claim.claim_submitted_at) {
    const hours = (Date.parse(claim.claim_submitted_at) - Date.parse(claim.policy_issued_at)) / 3_600_000;
    if (hours >= 0 && hours <= 48) add('early_claim_after_issue', ['policy_issued_at', 'claim_submitted_at']);
  }
  if (claim.cover_increase_at && claim.claim_submitted_at) {
    const days = (Date.parse(claim.claim_submitted_at) - Date.parse(claim.cover_increase_at)) / 86_400_000;
    if (days >= 0 && days <= 7) add('claim_after_cover_increase', ['cover_increase_at', 'claim_submitted_at']);
  }

  // Documents (TC-DUP-018, 019)
  if (claim.document?.sha256_hash && (hit = first((o) => o.document?.sha256_hash === claim.document?.sha256_hash))) {
    add('same_document_hash', ['document_sha256_hash'], hit);
  }
  if (claim.document?.perceptual_hash && (hit = first((o) => o.document?.perceptual_hash === claim.document?.perceptual_hash))) {
    add('same_document_perceptual_hash', ['document_perceptual_hash'], hit);
  }

  // Address last: fairness overrides apply only when it is the ONLY signal (TC-DUP-015, 022, 042, 043)
  if (claim.address_hash && (hit = first((o) => o.address_hash === claim.address_hash && o.insured_person?.id_number_hash !== deceasedHash))) {
    if (matches.length === 0 && claim.address_context === 'rural') add('rural_address_only', ['address_hash'], hit);
    else if (matches.length === 0 && claim.address_context === 'informal_settlement') add('informal_settlement_address_only', ['address_hash'], hit);
    else add(claim.context?.shared_household ? 'same_household_address' : 'same_address_multiple_claims', ['address_hash'], hit);
  }

  // Cross-insurer (TC-DUP-020)
  for (const sig of opts.cross_insurer_signals ?? []) {
    add('cross_insurer_duplicate_claim', ['id_number_hash', 'insurer'], undefined, { matched_insurer: sig.insurer, match_confidence: sig.match_confidence });
    break;
  }

  const total = matches.length;
  const paginated = total > maxMatches;
  const page = paginated ? matches.slice(0, maxMatches) : matches;

  let score = matches.reduce((s, m) => Math.max(s, m.score), 0);
  if (total > 20) score = 100; // TC-DUP-037
  score = Math.min(100, Math.round(score));

  const riskLevel = matches.reduce<RiskLevel>((l, m) => (LEVEL_SEVERITY.indexOf(m.risk_level) > LEVEL_SEVERITY.indexOf(l) ? m.risk_level : l), 'low');
  const top = matches.reduce<DuplicateMatch | undefined>((t, m) => (!t || ACTION_SEVERITY.indexOf(m.recommended_action) > ACTION_SEVERITY.indexOf(t.recommended_action) ? m : t), undefined);
  const review = total > 20 || matches.some((m) => m.human_review_required);
  const explanations = [...new Set(matches.flatMap((m) => m.innocent_explanations))];

  return {
    ...base,
    matches: page,
    total_matches: total,
    paginated,
    duplicate_risk_score: score,
    risk_level: total === 0 ? 'low' : riskLevel,
    recommended_action: top ? top.recommended_action : 'no_action',
    human_review_required: review,
    innocent_explanations: explanations,
    audit_event: { type: 'duplicate_check_completed', tenant_id: claim.tenant_id, claim_id: claim.claim_id, matches: total, score },
  };
}
