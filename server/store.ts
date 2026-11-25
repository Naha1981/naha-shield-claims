import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import {
  buildSeedEvidenceVault,
  COMPLIANCE_GUARDRAILS,
  DEFAULT_ORG_ID,
  SYNTHETIC_CLAIMS_PREVIEW,
  SYNTHETIC_CONSENT_POLICIES,
  SYNTHETIC_LEDGER_ENTRIES,
  SYNTHETIC_RECOVERY_CASES,
  SYNTHETIC_USERS,
} from '../db/seeds/syntheticData';
import type {
  AuditLogRecord,
  ClaimPreviewRecord,
  ConsentPolicyInput,
  EvidenceItemRecord,
  EvidenceTag,
  HumanDecisionRecord,
  KpiAuditNoteRecord,
  LedgerEntryInput,
  RecoveryCaseInput,
  RoleId,
} from '../src/lib/engine/types';
import { normalizeKpiAuditNoteContent } from '../src/lib/engine/popia';
import {
  computeChainHash,
  computeContentHash,
  GENESIS_CHAIN_HASH,
  VALID_EVIDENCE_TAGS,
  verifyEvidenceChain,
} from '../src/lib/engine/vault';
import {
  evaluateAnomalyThresholdAlerts,
  type AnomalyAlertRecord,
} from '../src/lib/engine/anomaly';

export interface AppStateSnapshot {
  org_id: string;
  org_name: string;
  residency_region: string;
  psi_phase3_unlocked: false;
  recovery_cases: RecoveryCaseInput[];
  ledger_entries: LedgerEntryInput[];
  consent_policies: ConsentPolicyInput[];
  claims_preview: ClaimPreviewRecord[];
  evidence_items: EvidenceItemRecord[];
  decisions: HumanDecisionRecord[];
  audit_log: AuditLogRecord[];
  tamper_backup_items: EvidenceItemRecord[] | null;
  anomaly_threshold_pct: number;
  anomaly_alerts: AnomalyAlertRecord[];
  kpi_audit_notes: KpiAuditNoteRecord[];
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STATE_FILE = path.join(DATA_DIR, 'nahashield-state.json');

export class NahaShieldStore {
  private state: AppStateSnapshot;
  private pool: Pool | null = null;
  public dbMode: 'postgres' | 'local-persistent' = 'local-persistent';

  constructor() {
    this.state = this.createInitialSeedState();
  }

  private createInitialSeedState(): AppStateSnapshot {
    const now = new Date().toISOString();
    const consentPolicies = structuredClone(SYNTHETIC_CONSENT_POLICIES);
    const defaultThreshold = 75;
    const initialAlerts = evaluateAnomalyThresholdAlerts({
      policies: consentPolicies,
      thresholdPct: defaultThreshold,
      existingAlerts: [],
      nowIso: now,
    }).alerts;

    return {
      org_id: DEFAULT_ORG_ID,
      org_name: 'UbuntuShield Life & Funeral (Synthetic Partner)',
      residency_region: process.env.NAHASHIELD_REGION || 'demo-render-synthetic-only',
      psi_phase3_unlocked: false,
      recovery_cases: structuredClone(SYNTHETIC_RECOVERY_CASES),
      ledger_entries: structuredClone(SYNTHETIC_LEDGER_ENTRIES),
      consent_policies: consentPolicies,
      claims_preview: structuredClone(SYNTHETIC_CLAIMS_PREVIEW),
      evidence_items: buildSeedEvidenceVault(),
      decisions: [
        {
          decision_id: 'DEC-0001',
          org_id: DEFAULT_ORG_ID,
          target_type: 'recovery_route',
          target_ref: 'SYN-RC-004',
          selected_action: 'Civil Delict (Masindi check) + CPA s300 (asset-verified) + AFU Pack',
          reviewer_id: 'usr_legal_01',
          reviewer_role: 'legal_recoveries',
          objective_reasons: [
            'WinDeed title verified freehold value R1.85m vs R320k bond',
            'CIPC confirms defendant beneficial ownership',
            'Counsel confirmed 60-day s300(5)(b) civil bar timeline',
          ],
          counsel_note: 'Proceed with summons & preserve AFU POCA s38 referral pack.',
          decided_at: '2026-10-14T10:30:00.000Z',
        },
      ],
      audit_log: [
        {
          audit_id: 'AUD-0001',
          org_id: DEFAULT_ORG_ID,
          actor_role: 'compliance_dpo',
          actor_id: 'usr_compliance_01',
          action: 'SEED_INITIALIZED',
          object_type: 'org_config',
          object_id: DEFAULT_ORG_ID,
          details: { mode: 'synthetic_only', pii_present: false },
          created_at: now,
        },
      ],
      tamper_backup_items: null,
      anomaly_threshold_pct: defaultThreshold,
      anomaly_alerts: initialAlerts,
      kpi_audit_notes: [],
    };
  }

  async init(): Promise<void> {
    if (process.env.DATABASE_URL) {
      try {
        this.pool = new Pool({
          connectionString: process.env.DATABASE_URL,
          ssl:
            process.env.NODE_ENV === 'production'
              ? { rejectUnauthorized: false }
              : undefined,
        });
        const migrationPath = path.resolve(
          process.cwd(),
          'db/migrations/001_initial_schema.sql',
        );
        const sql = fs.readFileSync(migrationPath, 'utf8');
        await this.pool.query(sql);
        await this.seedPostgresIfEmpty();
        await this.loadFromPostgres();
        this.ensureAnomalyStateInitialized();
        this.dbMode = 'postgres';
        return;
      } catch (err) {
        console.warn(
          '[NahaShield] Postgres connection unavailable, falling back to local persistent store:',
          err instanceof Error ? err.message : String(err),
        );
        this.pool = null;
      }
    }

    // Local file-backed persistence for zero-config preview / local development
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STATE_FILE)) {
      try {
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw) as AppStateSnapshot;
        if (parsed && parsed.org_id === DEFAULT_ORG_ID) {
          this.state = parsed;
          if (this.ensureAnomalyStateInitialized()) {
            this.persistLocal();
          }
          return;
        }
      } catch {
        // Re-seed if corrupted
      }
    }
    this.persistLocal();
  }

  private ensureAnomalyStateInitialized(): boolean {
    let changed = false;
    if (
      typeof this.state.anomaly_threshold_pct !== 'number' ||
      !Number.isFinite(this.state.anomaly_threshold_pct)
    ) {
      this.state.anomaly_threshold_pct = 75;
      changed = true;
    }
    if (!Array.isArray(this.state.anomaly_alerts)) {
      this.state.anomaly_alerts = evaluateAnomalyThresholdAlerts({
        policies: this.state.consent_policies,
        thresholdPct: this.state.anomaly_threshold_pct,
        existingAlerts: [],
      }).alerts;
      changed = true;
    }
    if (!Array.isArray(this.state.kpi_audit_notes)) {
      this.state.kpi_audit_notes = [];
      changed = true;
    }
    return changed;
  }

  private async seedPostgresIfEmpty(): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO org_config (org_id, org_name, residency_region)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id) DO NOTHING`,
      [
        DEFAULT_ORG_ID,
        'UbuntuShield Life & Funeral (Synthetic Partner)',
        process.env.NAHASHIELD_REGION || 'demo-render-synthetic-only',
      ],
    );

    for (const u of SYNTHETIC_USERS) {
      await this.pool.query(
        `INSERT INTO users (user_id, org_id, display_name, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO NOTHING`,
        [u.user_id, DEFAULT_ORG_ID, u.display_name, u.role],
      );
    }

    const { rows } = await this.pool.query(
      'SELECT COUNT(*)::int AS cnt FROM loss_register WHERE org_id = $1',
      [DEFAULT_ORG_ID],
    );
    if (rows[0].cnt === 0) {
      for (const c of SYNTHETIC_RECOVERY_CASES) {
        await this.pool.query(
          `INSERT INTO loss_register (
            case_id, org_id, policy_ref, claim_ref, defendant_alias, payout_date,
            original_payout, fraud_basis, title_type, primary_residence,
            est_sale_proceeds, senior_bonds, municipal_arrears, legal_costs,
            employment, ring_flag, registered_owner, legal_owner, beneficial_owner,
            assigned_owner, s300_deadline, status
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
          ON CONFLICT (case_id) DO NOTHING`,
          [
            c.case_id,
            DEFAULT_ORG_ID,
            c.policy_ref,
            c.claim_ref,
            c.defendant_alias,
            c.payout_date,
            c.original_payout,
            c.fraud_basis,
            c.title_type,
            c.primary_residence,
            c.est_sale_proceeds,
            c.senior_bonds,
            c.municipal_arrears,
            c.legal_costs,
            c.employment,
            c.ring_flag,
            c.registered_owner ?? c.defendant_alias,
            c.legal_owner ?? c.defendant_alias,
            c.beneficial_owner ?? c.defendant_alias,
            c.assigned_owner ?? 'Adv. N. van der Merwe',
            c.s300_deadline ?? null,
            c.status ?? 'Triaged',
          ],
        );
      }

      for (const l of SYNTHETIC_LEDGER_ENTRIES) {
        await this.pool.query(
          `INSERT INTO ledger_entries (
            entry_id, org_id, case_ref, basis, event_type, description,
            amount_at_stake, legal_costs, flagged_before_payout, existing_controls_flagged,
            human_confirmed, bank_reconciled, forensics_signoff, forensics_signoff_by,
            finance_signoff, finance_signoff_by, cleared_fp, review_hours, event_date
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
          ON CONFLICT (entry_id) DO NOTHING`,
          [
            l.entry_id,
            DEFAULT_ORG_ID,
            l.case_ref,
            l.basis,
            l.event_type,
            l.description,
            l.amount_at_stake,
            l.legal_costs,
            l.flagged_before_payout,
            l.existing_controls_flagged,
            l.human_confirmed,
            l.bank_reconciled,
            l.forensics_signoff,
            l.forensics_signoff_by ?? null,
            l.finance_signoff,
            l.finance_signoff_by ?? null,
            l.cleared_fp,
            l.review_hours,
            l.event_date,
          ],
        );
      }

      for (const p of SYNTHETIC_CONSENT_POLICIES) {
        await this.pool.query(
          `INSERT INTO consent_policies (
            policy_id, org_id, product_type, proposer_alias, assured_alias, payer_alias,
            proposer_ne_assured, payer_ne_assured, cover_amount, accidental_multiplier,
            cover_increase_12m, unrelated_lives_same_payer, beneficiary_relationship,
            independent_contact_on_file, contact_source, consent_record_exists,
            consent_via_independent_channel, preferred_language, duress_alert, cert_hash
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
          ON CONFLICT (policy_id) DO NOTHING`,
          [
            p.policy_id,
            DEFAULT_ORG_ID,
            p.product_type,
            p.proposer_alias,
            p.assured_alias,
            p.payer_alias,
            p.proposer_ne_assured,
            p.payer_ne_assured,
            p.cover_amount,
            p.accidental_multiplier,
            p.cover_increase_12m,
            p.unrelated_lives_same_payer,
            p.beneficiary_relationship,
            p.independent_contact_on_file,
            p.contact_source,
            p.consent_record_exists,
            p.consent_via_independent_channel,
            p.preferred_language,
            p.duress_alert,
            p.cert_hash ?? null,
          ],
        );
      }

      for (const clm of SYNTHETIC_CLAIMS_PREVIEW) {
        await this.pool.query(
          `INSERT INTO claims_preview (
            claim_id, org_id, policy_ref, deceased_alias, submitted_at,
            death_to_reg_days, inception_to_death_days, bi1663_box24_word_of_mouth,
            living_person_signal, dha_office_outlier, certifier_cluster_id,
            parlour_name, voluntary_parlour_elected, avs_r_status, agent_churn_flag,
            claim_amount, has_dispute_notice, dispute_opened_at, dispute_reason, status
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
          ON CONFLICT (claim_id) DO NOTHING`,
          [
            clm.claim_id,
            DEFAULT_ORG_ID,
            clm.policy_ref,
            clm.deceased_alias,
            clm.submitted_at,
            clm.death_to_reg_days,
            clm.inception_to_death_days,
            clm.bi1663_box24_word_of_mouth,
            clm.living_person_signal,
            clm.dha_office_outlier,
            clm.certifier_cluster_id,
            clm.parlour_name,
            clm.voluntary_parlour_elected,
            clm.avs_r_status,
            clm.agent_churn_flag,
            clm.claim_amount,
            clm.has_dispute_notice,
            clm.dispute_opened_at,
            clm.dispute_reason,
            clm.status,
          ],
        );
      }

      const seedVault = buildSeedEvidenceVault();
      for (const ev of seedVault) {
        await this.pool.query(
          `INSERT INTO evidence_items (
            evidence_id, org_id, case_ref, title, content_summary, evidence_tag,
            source_adapter, sha256_content, prev_chain_hash, chain_hash,
            uploader_id, access_authority, custody_log, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
          ON CONFLICT (evidence_id) DO NOTHING`,
          [
            ev.evidence_id,
            ev.org_id,
            ev.case_ref,
            ev.title,
            ev.content_summary,
            ev.evidence_tag,
            ev.source_adapter,
            ev.sha256_content,
            ev.prev_chain_hash,
            ev.chain_hash,
            ev.uploader_id,
            ev.access_authority,
            JSON.stringify(ev.custody_log),
            ev.created_at,
          ],
        );
      }
    }
  }

  private async loadFromPostgres(): Promise<void> {
    if (!this.pool) return;
    const [casesRes, ledgerRes, consentRes, claimsRes, evRes, decRes, audRes] =
      await Promise.all([
        this.pool.query(
          'SELECT * FROM loss_register WHERE org_id = $1 ORDER BY case_id',
          [DEFAULT_ORG_ID],
        ),
        this.pool.query(
          'SELECT * FROM ledger_entries WHERE org_id = $1 ORDER BY entry_id',
          [DEFAULT_ORG_ID],
        ),
        this.pool.query(
          'SELECT * FROM consent_policies WHERE org_id = $1 ORDER BY policy_id',
          [DEFAULT_ORG_ID],
        ),
        this.pool.query(
          'SELECT * FROM claims_preview WHERE org_id = $1 ORDER BY claim_id',
          [DEFAULT_ORG_ID],
        ),
        this.pool.query(
          'SELECT * FROM evidence_items WHERE org_id = $1 ORDER BY created_at ASC, evidence_id ASC',
          [DEFAULT_ORG_ID],
        ),
        this.pool.query(
          'SELECT * FROM decisions WHERE org_id = $1 ORDER BY decided_at DESC',
          [DEFAULT_ORG_ID],
        ),
        this.pool.query(
          'SELECT * FROM audit_log WHERE org_id = $1 ORDER BY created_at DESC LIMIT 120',
          [DEFAULT_ORG_ID],
        ),
      ]);

    this.state.recovery_cases = casesRes.rows.map((r) => ({
      case_id: r.case_id,
      policy_ref: r.policy_ref,
      claim_ref: r.claim_ref,
      defendant_alias: r.defendant_alias,
      payout_date: String(r.payout_date).slice(0, 10),
      original_payout: Number(r.original_payout),
      fraud_basis: r.fraud_basis,
      title_type: r.title_type,
      primary_residence: Boolean(r.primary_residence),
      est_sale_proceeds: Number(r.est_sale_proceeds),
      senior_bonds: Number(r.senior_bonds),
      municipal_arrears: Number(r.municipal_arrears),
      legal_costs: Number(r.legal_costs),
      employment: r.employment,
      ring_flag: Boolean(r.ring_flag),
      registered_owner: r.registered_owner,
      legal_owner: r.legal_owner,
      beneficial_owner: r.beneficial_owner,
      assigned_owner: r.assigned_owner,
      s300_deadline: r.s300_deadline ? String(r.s300_deadline).slice(0, 10) : undefined,
      status: r.status,
    }));

    this.state.ledger_entries = ledgerRes.rows.map((r) => ({
      entry_id: r.entry_id,
      case_ref: r.case_ref,
      basis: r.basis,
      event_type: r.event_type,
      description: r.description,
      amount_at_stake: Number(r.amount_at_stake),
      legal_costs: Number(r.legal_costs),
      flagged_before_payout: Boolean(r.flagged_before_payout),
      existing_controls_flagged: Boolean(r.existing_controls_flagged),
      human_confirmed: Boolean(r.human_confirmed),
      bank_reconciled: Boolean(r.bank_reconciled),
      forensics_signoff: Boolean(r.forensics_signoff),
      forensics_signoff_by: r.forensics_signoff_by,
      finance_signoff: Boolean(r.finance_signoff),
      finance_signoff_by: r.finance_signoff_by,
      cleared_fp: Boolean(r.cleared_fp),
      review_hours: Number(r.review_hours),
      event_date: String(r.event_date).slice(0, 10),
    }));

    this.state.consent_policies = consentRes.rows.map((r) => ({
      policy_id: r.policy_id,
      product_type: r.product_type,
      proposer_alias: r.proposer_alias,
      assured_alias: r.assured_alias,
      payer_alias: r.payer_alias,
      proposer_ne_assured: Boolean(r.proposer_ne_assured),
      payer_ne_assured: Boolean(r.payer_ne_assured),
      cover_amount: Number(r.cover_amount),
      accidental_multiplier: Number(r.accidental_multiplier),
      cover_increase_12m: Boolean(r.cover_increase_12m),
      unrelated_lives_same_payer: Number(r.unrelated_lives_same_payer),
      beneficiary_relationship: r.beneficiary_relationship,
      independent_contact_on_file: Boolean(r.independent_contact_on_file),
      contact_source: r.contact_source,
      consent_record_exists: Boolean(r.consent_record_exists),
      consent_via_independent_channel: Boolean(r.consent_via_independent_channel),
      preferred_language: r.preferred_language,
      duress_alert: Boolean(r.duress_alert),
      cert_hash: r.cert_hash,
    }));

    this.state.claims_preview = claimsRes.rows.map((r) => ({
      claim_id: r.claim_id,
      policy_ref: r.policy_ref,
      deceased_alias: r.deceased_alias,
      submitted_at: new Date(r.submitted_at).toISOString(),
      death_to_reg_days: Number(r.death_to_reg_days),
      inception_to_death_days: Number(r.inception_to_death_days),
      bi1663_box24_word_of_mouth: Boolean(r.bi1663_box24_word_of_mouth),
      living_person_signal: Boolean(r.living_person_signal),
      dha_office_outlier: Boolean(r.dha_office_outlier),
      certifier_cluster_id: r.certifier_cluster_id,
      parlour_name: r.parlour_name,
      voluntary_parlour_elected: Boolean(r.voluntary_parlour_elected),
      avs_r_status: r.avs_r_status,
      agent_churn_flag: Boolean(r.agent_churn_flag),
      claim_amount: Number(r.claim_amount),
      has_dispute_notice: Boolean(r.has_dispute_notice),
      dispute_opened_at: r.dispute_opened_at
        ? new Date(r.dispute_opened_at).toISOString()
        : null,
      dispute_reason: r.dispute_reason,
      status: r.status,
    }));

    this.state.evidence_items = evRes.rows.map((r) => ({
      evidence_id: r.evidence_id,
      org_id: r.org_id,
      case_ref: r.case_ref,
      title: r.title,
      content_summary: r.content_summary,
      evidence_tag: r.evidence_tag,
      source_adapter: r.source_adapter,
      sha256_content: r.sha256_content,
      prev_chain_hash: r.prev_chain_hash,
      chain_hash: r.chain_hash,
      uploader_id: r.uploader_id,
      access_authority: r.access_authority,
      custody_log: r.custody_log,
      created_at: new Date(r.created_at).toISOString(),
    }));

    this.state.decisions = decRes.rows.map((r) => ({
      decision_id: r.decision_id,
      org_id: r.org_id,
      target_type: r.target_type,
      target_ref: r.target_ref,
      selected_action: r.selected_action,
      reviewer_id: r.reviewer_id,
      reviewer_role: r.reviewer_role,
      objective_reasons: r.objective_reasons,
      counsel_note: r.counsel_note,
      decided_at: new Date(r.decided_at).toISOString(),
    }));

    this.state.audit_log = audRes.rows.map((r) => ({
      audit_id: r.audit_id,
      org_id: r.org_id,
      actor_role: r.actor_role,
      actor_id: r.actor_id,
      action: r.action,
      object_type: r.object_type,
      object_id: r.object_id,
      details: r.details,
      created_at: new Date(r.created_at).toISOString(),
    }));
  }

  private persistLocal(): void {
    if (this.pool) return;
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), 'utf8');
  }

  getSnapshot(): AppStateSnapshot & {
    users: typeof SYNTHETIC_USERS;
    guardrails: typeof COMPLIANCE_GUARDRAILS;
    db_mode: string;
    vault_verification: ReturnType<typeof verifyEvidenceChain>;
    tamper_simulated: boolean;
  } {
    return {
      ...this.state,
      users: SYNTHETIC_USERS,
      guardrails: COMPLIANCE_GUARDRAILS,
      db_mode: this.dbMode,
      vault_verification: verifyEvidenceChain(this.state.evidence_items),
      tamper_simulated: this.state.tamper_backup_items !== null,
    };
  }

  async logAudit(entry: {
    actor_role: RoleId;
    actor_id: string;
    action: string;
    object_type: string;
    object_id: string;
    details?: Record<string, unknown>;
  }): Promise<AuditLogRecord> {
    const record: AuditLogRecord = {
      audit_id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      org_id: DEFAULT_ORG_ID,
      actor_role: entry.actor_role,
      actor_id: entry.actor_id,
      action: entry.action,
      object_type: entry.object_type,
      object_id: entry.object_id,
      details: entry.details ?? {},
      created_at: new Date().toISOString(),
    };

    if (this.pool) {
      await this.pool.query(
        `INSERT INTO audit_log (audit_id, org_id, actor_role, actor_id, action, object_type, object_id, details, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
        [
          record.audit_id,
          record.org_id,
          record.actor_role,
          record.actor_id,
          record.action,
          record.object_type,
          record.object_id,
          JSON.stringify(record.details),
          record.created_at,
        ],
      );
    }

    this.state.audit_log = [record, ...this.state.audit_log].slice(0, 150);
    this.persistLocal();
    return record;
  }

  async toggleLedgerSignoff(params: {
    entry_id: string;
    signoff_type: 'forensics' | 'finance';
    signed: boolean;
    actor_role: RoleId;
    actor_id: string;
    actor_name: string;
  }): Promise<LedgerEntryInput> {
    const entry = this.state.ledger_entries.find(
      (e) => e.entry_id === params.entry_id,
    );
    if (!entry) {
      throw new Error(`Ledger entry ${params.entry_id} not found`);
    }

    if (params.signoff_type === 'forensics') {
      entry.forensics_signoff = params.signed;
      entry.forensics_signoff_by = params.signed ? params.actor_name : null;
    } else {
      entry.finance_signoff = params.signed;
      entry.finance_signoff_by = params.signed ? params.actor_name : null;
    }

    if (this.pool) {
      await this.pool.query(
        `UPDATE ledger_entries
         SET forensics_signoff = $1, forensics_signoff_by = $2,
             finance_signoff = $3, finance_signoff_by = $4
         WHERE entry_id = $5 AND org_id = $6`,
        [
          entry.forensics_signoff,
          entry.forensics_signoff_by ?? null,
          entry.finance_signoff,
          entry.finance_signoff_by ?? null,
          entry.entry_id,
          DEFAULT_ORG_ID,
        ],
      );
    }

    this.persistLocal();
    await this.logAudit({
      actor_role: params.actor_role,
      actor_id: params.actor_id,
      action: params.signed
        ? `LEDGER_${params.signoff_type.toUpperCase()}_SIGNED`
        : `LEDGER_${params.signoff_type.toUpperCase()}_REVOKED`,
      object_type: 'ledger_entry',
      object_id: entry.entry_id,
      details: { amount_at_stake: entry.amount_at_stake, basis: entry.basis },
    });

    return entry;
  }

  async addRecoveryCase(
    newCase: RecoveryCaseInput,
    actor_role: RoleId,
    actor_id: string,
  ): Promise<RecoveryCaseInput> {
    if (this.state.recovery_cases.some((c) => c.case_id === newCase.case_id)) {
      throw new Error(`Case ID ${newCase.case_id} already exists`);
    }

    if (this.pool) {
      await this.pool.query(
        `INSERT INTO loss_register (
          case_id, org_id, policy_ref, claim_ref, defendant_alias, payout_date,
          original_payout, fraud_basis, title_type, primary_residence,
          est_sale_proceeds, senior_bonds, municipal_arrears, legal_costs,
          employment, ring_flag, registered_owner, legal_owner, beneficial_owner,
          assigned_owner, s300_deadline, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [
          newCase.case_id,
          DEFAULT_ORG_ID,
          newCase.policy_ref,
          newCase.claim_ref,
          newCase.defendant_alias,
          newCase.payout_date,
          newCase.original_payout,
          newCase.fraud_basis,
          newCase.title_type,
          newCase.primary_residence,
          newCase.est_sale_proceeds,
          newCase.senior_bonds,
          newCase.municipal_arrears,
          newCase.legal_costs,
          newCase.employment,
          newCase.ring_flag,
          newCase.registered_owner ?? newCase.defendant_alias,
          newCase.legal_owner ?? newCase.defendant_alias,
          newCase.beneficial_owner ?? newCase.defendant_alias,
          newCase.assigned_owner ?? 'Adv. N. van der Merwe',
          newCase.s300_deadline ?? null,
          newCase.status ?? 'Triaged',
        ],
      );
    }

    this.state.recovery_cases = [newCase, ...this.state.recovery_cases];
    this.persistLocal();
    await this.logAudit({
      actor_role,
      actor_id,
      action: 'RECOVERY_CASE_IMPORTED',
      object_type: 'loss_register',
      object_id: newCase.case_id,
      details: {
        original_payout: newCase.original_payout,
        title_type: newCase.title_type,
      },
    });
    return newCase;
  }

  async recordDecision(params: {
    target_type: HumanDecisionRecord['target_type'];
    target_ref: string;
    selected_action: string;
    reviewer_id: string;
    reviewer_role: RoleId;
    objective_reasons: string[];
    counsel_note?: string;
  }): Promise<HumanDecisionRecord> {
    if (!params.reviewer_id?.trim()) {
      throw new Error('POPIA s71 violation: reviewer_id is required');
    }
    const cleanReasons = (params.objective_reasons ?? [])
      .map((r) => r.trim())
      .filter(Boolean);
    if (cleanReasons.length === 0) {
      throw new Error(
        'POPIA s71 violation: at least one objective reason is required',
      );
    }

    const record: HumanDecisionRecord = {
      decision_id: `DEC-${Date.now().toString().slice(-6)}`,
      org_id: DEFAULT_ORG_ID,
      target_type: params.target_type,
      target_ref: params.target_ref,
      selected_action: params.selected_action,
      reviewer_id: params.reviewer_id.trim(),
      reviewer_role: params.reviewer_role,
      objective_reasons: cleanReasons,
      counsel_note: params.counsel_note?.trim(),
      decided_at: new Date().toISOString(),
    };

    if (this.pool) {
      await this.pool.query(
        `INSERT INTO decisions (
          decision_id, org_id, target_type, target_ref, selected_action,
          reviewer_id, reviewer_role, objective_reasons, counsel_note, decided_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          record.decision_id,
          record.org_id,
          record.target_type,
          record.target_ref,
          record.selected_action,
          record.reviewer_id,
          record.reviewer_role,
          record.objective_reasons,
          record.counsel_note ?? null,
          record.decided_at,
        ],
      );
    }

    this.state.decisions = [record, ...this.state.decisions];
    if (params.target_type === 'recovery_route') {
      const targetCase = this.state.recovery_cases.find(
        (c) => c.case_id === params.target_ref,
      );
      if (targetCase) {
        targetCase.status = 'Human Counsel Approved';
      }
    }

    this.persistLocal();
    await this.logAudit({
      actor_role: params.reviewer_role,
      actor_id: params.reviewer_id,
      action: 'HUMAN_DECISION_RECORDED',
      object_type: params.target_type,
      object_id: params.target_ref,
      details: {
        decision_id: record.decision_id,
        selected_action: record.selected_action,
        reasons_count: cleanReasons.length,
      },
    });
    return record;
  }

  async appendEvidence(params: {
    case_ref: string;
    title: string;
    content_summary: string;
    evidence_tag: EvidenceTag;
    source_adapter: string;
    uploader_id: string;
    actor_role: RoleId;
    access_authority: string;
    attachment_meta?: EvidenceItemRecord['attachment_meta'];
  }): Promise<EvidenceItemRecord> {
    if (!params.evidence_tag || !VALID_EVIDENCE_TAGS.has(params.evidence_tag)) {
      throw new Error('Mandatory evidence_tag missing or invalid');
    }
    if (this.state.tamper_backup_items !== null) {
      throw new Error(
        'Vault integrity failed closed: restore verified chain before appending new evidence',
      );
    }

    const prev_chain_hash =
      this.state.evidence_items.length > 0
        ? this.state.evidence_items[this.state.evidence_items.length - 1]
            .chain_hash
        : GENESIS_CHAIN_HASH;

    const evidence_id = `EVD-${String(this.state.evidence_items.length + 1).padStart(4, '0')}`;
    const created_at = new Date().toISOString();
    const sha256_content = computeContentHash(params.content_summary);
    const chain_hash = computeChainHash({
      prev_chain_hash,
      sha256_content,
      evidence_id,
      org_id: DEFAULT_ORG_ID,
      case_ref: params.case_ref,
      evidence_tag: params.evidence_tag,
      uploader_id: params.uploader_id,
      created_at,
    });

    const item: EvidenceItemRecord = {
      evidence_id,
      org_id: DEFAULT_ORG_ID,
      case_ref: params.case_ref,
      title: params.title,
      content_summary: params.content_summary,
      evidence_tag: params.evidence_tag,
      source_adapter: params.source_adapter,
      sha256_content,
      prev_chain_hash,
      chain_hash,
      uploader_id: params.uploader_id,
      access_authority: params.access_authority,
      custody_log: [
        {
          actor: params.uploader_id,
          action: params.attachment_meta
            ? `SEALED_INGESTED_${params.attachment_meta.capture_mode.toUpperCase()}`
            : 'SEALED_APPEND_ONLY',
          ts: created_at,
        },
      ],
      created_at,
      ...(params.attachment_meta
        ? { attachment_meta: params.attachment_meta }
        : {}),
    };

    if (this.pool) {
      await this.pool.query(
        `INSERT INTO evidence_items (
          evidence_id, org_id, case_ref, title, content_summary, evidence_tag,
          source_adapter, sha256_content, prev_chain_hash, chain_hash,
          uploader_id, access_authority, custody_log, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)`,
        [
          item.evidence_id,
          item.org_id,
          item.case_ref,
          item.title,
          item.content_summary,
          item.evidence_tag,
          item.source_adapter,
          item.sha256_content,
          item.prev_chain_hash,
          item.chain_hash,
          item.uploader_id,
          item.access_authority,
          JSON.stringify(item.custody_log),
          item.created_at,
        ],
      );
    }

    this.state.evidence_items = [...this.state.evidence_items, item];
    this.persistLocal();
    await this.logAudit({
      actor_role: params.actor_role,
      actor_id: params.uploader_id,
      action: 'EVIDENCE_APPENDED',
      object_type: 'evidence_item',
      object_id: item.evidence_id,
      details: {
        case_ref: item.case_ref,
        evidence_tag: item.evidence_tag,
        chain_hash: item.chain_hash,
      },
    });
    return item;
  }

  async simulateTamperAttack(actor_role: RoleId, actor_id: string) {
    if (this.state.evidence_items.length < 2) {
      throw new Error('Need at least 2 evidence items to simulate tampering');
    }
    if (!this.state.tamper_backup_items) {
      this.state.tamper_backup_items = structuredClone(this.state.evidence_items);
    }
    const targetIdx = Math.min(1, this.state.evidence_items.length - 1);
    this.state.evidence_items[targetIdx] = {
      ...this.state.evidence_items[targetIdx],
      content_summary:
        this.state.evidence_items[targetIdx].content_summary +
        ' [SIMULATED_TAMPER_ALTERED_FIGURE]',
    };
    this.persistLocal();
    const verification = verifyEvidenceChain(this.state.evidence_items);
    await this.logAudit({
      actor_role,
      actor_id,
      action: 'VAULT_TAMPER_SIMULATED',
      object_type: 'evidence_vault',
      object_id: verification.failed_evidence_id ?? 'unknown',
      details: { failed_closed: !verification.valid, reason: verification.reason },
    });
    return verification;
  }

  async restoreValidChain(actor_role: RoleId, actor_id: string) {
    if (this.state.tamper_backup_items) {
      this.state.evidence_items = structuredClone(this.state.tamper_backup_items);
      this.state.tamper_backup_items = null;
      this.persistLocal();
    }
    const verification = verifyEvidenceChain(this.state.evidence_items);
    await this.logAudit({
      actor_role,
      actor_id,
      action: 'VAULT_CHAIN_RESTORED',
      object_type: 'evidence_vault',
      object_id: DEFAULT_ORG_ID,
      details: { valid: verification.valid },
    });
    return verification;
  }

  async applyConsentSimulation(params: {
    policy_id: string;
    outcome: 'confirm' | 'decline' | 'duress';
    independent_contact_on_file: boolean;
    language: ConsentPolicyInput['preferred_language'];
    actor_role: RoleId;
    actor_id: string;
  }) {
    const policy = this.state.consent_policies.find(
      (p) => p.policy_id === params.policy_id,
    );
    if (!policy) {
      throw new Error(`Policy ${params.policy_id} not found`);
    }

    policy.independent_contact_on_file = params.independent_contact_on_file;
    policy.contact_source = params.independent_contact_on_file
      ? 'KYC Bureau'
      : 'Applicant-Supplied Only';
    policy.preferred_language = params.language;

    let evidenceNote = '';
    if (params.outcome === 'confirm') {
      policy.consent_record_exists = true;
      policy.consent_via_independent_channel = params.independent_contact_on_file;
      policy.duress_alert = false;
      policy.cert_hash = `cert-${Date.now().toString(16)}`;
      evidenceNote = `Life assured confirmed cover & comprehension answer in ${params.language} (independent_contact=${params.independent_contact_on_file}).`;
    } else if (params.outcome === 'decline') {
      policy.consent_record_exists = true;
      policy.consent_via_independent_channel = params.independent_contact_on_file;
      policy.duress_alert = false;
      policy.cert_hash = null;
      evidenceNote = `Life assured DECLINED / unrecognised cover in ${params.language}; policy paused for underwriter review.`;
    } else {
      policy.consent_record_exists = true;
      policy.consent_via_independent_channel = params.independent_contact_on_file;
      policy.duress_alert = true;
      policy.cert_hash = `duress-${Date.now().toString(16)}`;
      evidenceNote = `SILENT DURESS ("Not Me") triggered in ${params.language}. External screen rendered generic system timeout; silent underwriting alert opened.`;
    }

    if (this.pool) {
      await this.pool.query(
        `UPDATE consent_policies
         SET independent_contact_on_file=$1, contact_source=$2, preferred_language=$3,
             consent_record_exists=$4, consent_via_independent_channel=$5,
             duress_alert=$6, cert_hash=$7, updated_at=NOW()
         WHERE policy_id=$8 AND org_id=$9`,
        [
          policy.independent_contact_on_file,
          policy.contact_source,
          policy.preferred_language,
          policy.consent_record_exists,
          policy.consent_via_independent_channel,
          policy.duress_alert,
          policy.cert_hash ?? null,
          policy.policy_id,
          DEFAULT_ORG_ID,
        ],
      );
    }

    let evidenceItem: EvidenceItemRecord | null = null;
    if (this.state.tamper_backup_items === null) {
      evidenceItem = await this.appendEvidence({
        case_ref: policy.policy_id,
        title:
          params.outcome === 'duress'
            ? `Silent Duress Telemetry — ${policy.policy_id}`
            : `Out-of-Band Consent Response — ${policy.policy_id}`,
        content_summary: evidenceNote,
        evidence_tag: 'Verified Fact',
        source_adapter: 'SIMULATED ADAPTER (WhatsApp / USSD Gateway)',
        uploader_id: params.actor_id,
        actor_role: params.actor_role,
        access_authority: 'PPR Third-Party Consent Verification',
      });
    }

    this.persistLocal();
    await this.logAudit({
      actor_role: params.actor_role,
      actor_id: params.actor_id,
      action:
        params.outcome === 'duress'
          ? 'CONSENT_SILENT_DURESS_TRIGGERED'
          : `CONSENT_${params.outcome.toUpperCase()}`,
      object_type: 'consent_policy',
      object_id: policy.policy_id,
      details: {
        language: params.language,
        independent_contact_on_file: params.independent_contact_on_file,
        vault_hash: evidenceItem?.chain_hash ?? null,
      },
    });

    const newlyTriggeredAlerts = await this.recomputeAnomalyAlerts(
      params.actor_role,
      params.actor_id,
    );

    return {
      policy,
      evidenceItem,
      newly_triggered_alerts: newlyTriggeredAlerts,
      external_screen_message:
        params.outcome === 'duress'
          ? 'System timeout — please try again later.'
          : params.outcome === 'confirm'
            ? 'Thank you. Your cover confirmation has been recorded.'
            : 'Thank you. Your response has been recorded and a specialist will follow up.',
    };
  }

  private async recomputeAnomalyAlerts(
    actorRole: RoleId,
    actorId: string,
  ): Promise<AnomalyAlertRecord[]> {
    const evaluated = evaluateAnomalyThresholdAlerts({
      policies: this.state.consent_policies,
      thresholdPct: this.state.anomaly_threshold_pct,
      existingAlerts: this.state.anomaly_alerts ?? [],
    });
    this.state.anomaly_alerts = evaluated.alerts;
    this.persistLocal();

    for (const item of evaluated.newlyTriggered) {
      await this.logAudit({
        actor_role: actorRole,
        actor_id: actorId,
        action: 'ANOMALY_THRESHOLD_BREACHED',
        object_type: 'anomaly_alert',
        object_id: item.alert_id,
        details: {
          product_type: item.product_type,
          pattern_id: item.pattern_id,
          density_pct: item.density_pct,
          threshold_pct: item.threshold_pct,
          affected_count: item.affected_count,
          exposure_zar: item.exposure_zar,
        },
      });
    }

    return evaluated.newlyTriggered;
  }

  async updateAnomalyThreshold(
    thresholdPct: number,
    actorRole: RoleId,
    actorId: string,
  ): Promise<{
    threshold_pct: number;
    alerts: AnomalyAlertRecord[];
    newly_triggered: AnomalyAlertRecord[];
  }> {
    if (!Number.isFinite(thresholdPct) || thresholdPct < 5 || thresholdPct > 100) {
      throw new Error('Anomaly alert threshold must be between 5% and 100%.');
    }
    const rounded = Math.round(thresholdPct);
    this.state.anomaly_threshold_pct = rounded;
    this.persistLocal();

    await this.logAudit({
      actor_role: actorRole,
      actor_id: actorId,
      action: 'ANOMALY_THRESHOLD_UPDATED',
      object_type: 'anomaly_threshold',
      object_id: DEFAULT_ORG_ID,
      details: { threshold_pct: rounded },
    });

    const newlyTriggered = await this.recomputeAnomalyAlerts(actorRole, actorId);
    return {
      threshold_pct: rounded,
      alerts: this.state.anomaly_alerts,
      newly_triggered: newlyTriggered,
    };
  }

  async acknowledgeAnomalyAlert(
    alertId: string,
    actorRole: RoleId,
    actorId: string,
    actorName: string,
  ): Promise<AnomalyAlertRecord[]> {
    const now = new Date().toISOString();
    const alerts = this.state.anomaly_alerts ?? [];
    let ackCount = 0;

    if (alertId === 'all') {
      this.state.anomaly_alerts = alerts.map((a) => {
        if (!a.acknowledged) {
          ackCount += 1;
          return {
            ...a,
            acknowledged: true,
            acknowledged_by: actorName,
            acknowledged_at: now,
          };
        }
        return a;
      });
    } else {
      const target = alerts.find((a) => a.alert_id === alertId);
      if (!target) {
        throw new Error(`Anomaly alert ${alertId} not found`);
      }
      this.state.anomaly_alerts = alerts.map((a) =>
        a.alert_id === alertId
          ? {
              ...a,
              acknowledged: true,
              acknowledged_by: actorName,
              acknowledged_at: now,
            }
          : a,
      );
      ackCount = 1;
    }

    this.state.anomaly_alerts.sort((a, b) => {
      if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1;
      return b.density_pct - a.density_pct || b.exposure_zar - a.exposure_zar;
    });

    this.persistLocal();
    await this.logAudit({
      actor_role: actorRole,
      actor_id: actorId,
      action: 'ANOMALY_ALERT_ACKNOWLEDGED',
      object_type: 'anomaly_alert',
      object_id: alertId,
      details: {
        acknowledged_by: actorName,
        acknowledged_count: ackCount,
      },
    });
    return this.state.anomaly_alerts;
  }

  async openClaimDisputeNotice(params: {
    claim_id: string;
    notice_text: string;
    actor_role: RoleId;
    actor_id: string;
  }) {
    const claim = this.state.claims_preview.find(
      (c) => c.claim_id === params.claim_id,
    );
    if (!claim) {
      throw new Error(`Claim ${params.claim_id} not found`);
    }

    const now = new Date().toISOString();
    claim.has_dispute_notice = true;
    claim.dispute_opened_at = now;
    claim.dispute_reason = params.notice_text;
    claim.status = '14-Day Dispute Open (Basdeo Notice Sent)';

    if (this.pool) {
      await this.pool.query(
        `UPDATE claims_preview
         SET has_dispute_notice = TRUE, dispute_opened_at = $1, dispute_reason = $2, status = $3
         WHERE claim_id = $4 AND org_id = $5`,
        [now, params.notice_text, claim.status, claim.claim_id, DEFAULT_ORG_ID],
      );
    }

    this.persistLocal();
    await this.logAudit({
      actor_role: params.actor_role,
      actor_id: params.actor_id,
      action: 'BASDEO_DISPUTE_NOTICE_ISSUED',
      object_type: 'claim_preview',
      object_id: claim.claim_id,
      details: { assessor_id: params.actor_id },
    });
    return claim;
  }

  async addKpiAuditNote(params: {
    content: string;
    actor_role: RoleId;
    actor_id: string;
    actor_name: string;
    include_in_pdf?: boolean;
  }): Promise<{ note: KpiAuditNoteRecord; notes: KpiAuditNoteRecord[] }> {
    const cleanContent = normalizeKpiAuditNoteContent(params.content);
    const now = new Date().toISOString();
    const note: KpiAuditNoteRecord = {
      note_id: `NOTE-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      org_id: DEFAULT_ORG_ID,
      content: cleanContent,
      created_at: now,
      author_id: params.actor_id,
      author_name: params.actor_name,
      author_role: params.actor_role,
      include_in_pdf: params.include_in_pdf ?? true,
    };

    const existing = Array.isArray(this.state.kpi_audit_notes)
      ? this.state.kpi_audit_notes
      : [];
    this.state.kpi_audit_notes = [note, ...existing].slice(0, 25);
    this.persistLocal();

    await this.logAudit({
      actor_role: params.actor_role,
      actor_id: params.actor_id,
      action: 'KPI_AUDIT_NOTE_ADDED',
      object_type: 'kpi_audit_note',
      object_id: note.note_id,
      details: {
        author_name: params.actor_name,
        include_in_pdf: note.include_in_pdf,
        char_count: note.content.length,
      },
    });

    return { note, notes: this.state.kpi_audit_notes };
  }

  async toggleKpiAuditNotePdf(params: {
    note_id: string;
    include_in_pdf: boolean;
    actor_role: RoleId;
    actor_id: string;
  }): Promise<KpiAuditNoteRecord[]> {
    const notes = this.state.kpi_audit_notes ?? [];
    const target = notes.find((n) => n.note_id === params.note_id);
    if (!target) {
      throw new Error(`KPI audit note ${params.note_id} not found`);
    }
    this.state.kpi_audit_notes = notes.map((n) =>
      n.note_id === params.note_id
        ? { ...n, include_in_pdf: params.include_in_pdf }
        : n,
    );
    this.persistLocal();

    await this.logAudit({
      actor_role: params.actor_role,
      actor_id: params.actor_id,
      action: 'KPI_AUDIT_NOTE_PDF_TOGGLED',
      object_type: 'kpi_audit_note',
      object_id: params.note_id,
      details: { include_in_pdf: params.include_in_pdf },
    });

    return this.state.kpi_audit_notes;
  }

  async deleteKpiAuditNote(params: {
    note_id: string;
    actor_role: RoleId;
    actor_id: string;
  }): Promise<KpiAuditNoteRecord[]> {
    const notes = this.state.kpi_audit_notes ?? [];
    const exists = notes.some((n) => n.note_id === params.note_id);
    if (!exists) {
      throw new Error(`KPI audit note ${params.note_id} not found`);
    }
    this.state.kpi_audit_notes = notes.filter(
      (n) => n.note_id !== params.note_id,
    );
    this.persistLocal();

    await this.logAudit({
      actor_role: params.actor_role,
      actor_id: params.actor_id,
      action: 'KPI_AUDIT_NOTE_REMOVED',
      object_type: 'kpi_audit_note',
      object_id: params.note_id,
    });

    return this.state.kpi_audit_notes;
  }

  async pingStore(): Promise<{
    ok: boolean;
    mode: 'postgres' | 'local-persistent';
    latencyMs: number;
    fileBytes?: number;
  }> {
    const start = performance.now();
    if (this.pool) {
      await this.pool.query('SELECT 1');
      return {
        ok: true,
        mode: 'postgres',
        latencyMs: Math.round((performance.now() - start) * 10) / 10,
      };
    }

    let fileBytes = 0;
    if (fs.existsSync(STATE_FILE)) {
      const stat = fs.statSync(STATE_FILE);
      fileBytes = stat.size;
    }
    return {
      ok: true,
      mode: 'local-persistent',
      latencyMs: Math.round((performance.now() - start) * 10) / 10,
      fileBytes,
    };
  }
}
