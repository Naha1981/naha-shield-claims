import { createHash } from 'node:crypto';
import type {
  EvidenceItemRecord,
  EvidenceTag,
  VaultVerificationResult,
} from './types';

export const GENESIS_CHAIN_HASH =
  '0000000000000000000000000000000000000000000000000000000000000000';

export const VALID_EVIDENCE_TAGS: ReadonlySet<EvidenceTag> = new Set([
  'Verified Fact',
  'Documented Allegation',
  'Inference',
  'Hypothesis',
  'Unknown',
]);

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function computeContentHash(contentSummary: string): string {
  return sha256Hex(contentSummary);
}

export function computeChainHash(params: {
  prev_chain_hash: string;
  sha256_content: string;
  evidence_id: string;
  org_id: string;
  case_ref: string;
  evidence_tag: EvidenceTag;
  uploader_id: string;
  created_at: string;
}): string {
  const canonicalMetadata = JSON.stringify({
    evidence_id: params.evidence_id,
    org_id: params.org_id,
    case_ref: params.case_ref,
    evidence_tag: params.evidence_tag,
    uploader_id: params.uploader_id,
    created_at: params.created_at,
  });
  return sha256Hex(
    `${params.prev_chain_hash}|${params.sha256_content}|${canonicalMetadata}`,
  );
}

/**
 * Verifies an ordered chronological sequence of append-only evidence items.
 * Fails closed on any missing tag, content hash mismatch, prev_chain_hash break,
 * or chain_hash mismatch.
 */
export function verifyEvidenceChain(
  items: EvidenceItemRecord[],
): VaultVerificationResult {
  let expectedPrevHash = GENESIS_CHAIN_HASH;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];

    if (!item.evidence_tag || !VALID_EVIDENCE_TAGS.has(item.evidence_tag)) {
      return {
        valid: false,
        checked_count: i + 1,
        failed_index: i,
        failed_evidence_id: item.evidence_id,
        reason: `Missing or invalid evidence_tag on ${item.evidence_id}`,
      };
    }

    const actualContentHash = computeContentHash(item.content_summary);
    if (actualContentHash !== item.sha256_content) {
      return {
        valid: false,
        checked_count: i + 1,
        failed_index: i,
        failed_evidence_id: item.evidence_id,
        reason: `Content hash mismatch on ${item.evidence_id} (payload modified after sealing)`,
      };
    }

    if (item.prev_chain_hash !== expectedPrevHash) {
      return {
        valid: false,
        checked_count: i + 1,
        failed_index: i,
        failed_evidence_id: item.evidence_id,
        reason: `Previous chain link broken at ${item.evidence_id} (prior item altered or deleted)`,
      };
    }

    const expectedChainHash = computeChainHash({
      prev_chain_hash: item.prev_chain_hash,
      sha256_content: item.sha256_content,
      evidence_id: item.evidence_id,
      org_id: item.org_id,
      case_ref: item.case_ref,
      evidence_tag: item.evidence_tag,
      uploader_id: item.uploader_id,
      created_at: item.created_at,
    });

    if (item.chain_hash !== expectedChainHash) {
      return {
        valid: false,
        checked_count: i + 1,
        failed_index: i,
        failed_evidence_id: item.evidence_id,
        reason: `Chain hash signature invalid at ${item.evidence_id}`,
      };
    }

    expectedPrevHash = item.chain_hash;
  }

  return {
    valid: true,
    checked_count: items.length,
    failed_index: null,
    failed_evidence_id: null,
    reason: null,
  };
}
