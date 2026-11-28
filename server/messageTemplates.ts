// Claimant message templates from Thabiso's second spec (2026-11-28, section 8).
//
// HARD RULES (from his spec and the parent's relay):
//   * The insurer name is ALWAYS a variable: never hardcode an insurer.
//   * Templates are drafts needing human approval.
//   * The app never sends SMS or email to claimants. Sending stays disabled.
//   * Neutral tone, no accusation, no fraud language, plain language, a clear
//     action, a deadline where one applies, and the appeal route.

export type TemplateId =
  | 'claim_received_v1'
  | 'claim_documents_required_v1'
  | 'claim_callback_required_v1'
  | 'claim_on_hold_v1'
  | 'claim_approved_v1'
  | 'claim_declined_v1'
  | 'claim_reduced_v1'
  | 'appeal_received_v1'
  | 'appeal_outcome_v1'
  | 'duplicate_cover_query_v1';

export type TemplateVars = {
  insurer_name: string; // required, always a variable
  claim_reference?: string;
  document_type?: string;
  due_date?: string;
  phone_number?: string;
  office_hours?: string;
};

type Renderable = { id: TemplateId; channel: 'sms'; render: (v: TemplateVars) => string };

const ref = (v: TemplateVars) => v.claim_reference ?? 'your claim';
const phone = (v: TemplateVars) => v.phone_number ?? 'our office';
const hours = (v: TemplateVars) => v.office_hours ?? 'between 08:00 and 17:00, Monday to Friday';

export const MESSAGE_TEMPLATES: Renderable[] = [
  { id: 'claim_received_v1', channel: 'sms', render: (v) => `${v.insurer_name}: Your funeral claim ${ref(v)} has been received. We will contact you if we need more information. Reply HELP for assistance.` },
  { id: 'claim_documents_required_v1', channel: 'sms', render: (v) => `${v.insurer_name}: We need one more document to finalise claim ${ref(v)}: ${v.document_type ?? 'a required document'}. Please submit it by ${v.due_date ?? 'the date in our letter'}. Reply HELP for assistance.` },
  { id: 'claim_callback_required_v1', channel: 'sms', render: (v) => `${v.insurer_name}: We need to confirm a few details about claim ${ref(v)}. Please call ${phone(v)} ${hours(v)}. Reference: ${ref(v)}.` },
  { id: 'claim_on_hold_v1', channel: 'sms', render: (v) => `${v.insurer_name}: Claim ${ref(v)} is being reviewed. We will contact you by ${v.due_date ?? 'the date in our letter'}. If you have questions, reply HELP.` },
  { id: 'claim_approved_v1', channel: 'sms', render: (v) => `${v.insurer_name}: Good news. Claim ${ref(v)} has been approved. Payment will be processed to the approved beneficiary account.` },
  { id: 'claim_declined_v1', channel: 'sms', render: (v) => `${v.insurer_name}: Claim ${ref(v)} could not be approved. A written explanation and review options have been sent to your registered contact details.` },
  { id: 'claim_reduced_v1', channel: 'sms', render: (v) => `${v.insurer_name}: Claim ${ref(v)} has been approved for a reduced amount. A written explanation and review options have been sent to your registered contact details.` },
  { id: 'appeal_received_v1', channel: 'sms', render: (v) => `${v.insurer_name}: We have received your review request for claim ${ref(v)}. A separate reviewer will assess it and contact you with the outcome.` },
  { id: 'appeal_outcome_v1', channel: 'sms', render: (v) => `${v.insurer_name}: Your review request for claim ${ref(v)} has been completed. A written outcome has been sent to your registered contact details.` },
  { id: 'duplicate_cover_query_v1', channel: 'sms', render: (v) => `${v.insurer_name}: We need to confirm whether there is existing funeral cover for the person on claim ${ref(v)}. Please call ${phone(v)}. Reference: ${ref(v)}.` },
];

// Renders a DRAFT for human review. The result is always marked as a draft;
// there is deliberately no send path anywhere in the app.
export function renderDraft(templateId: TemplateId, vars: TemplateVars): { template_id: TemplateId; status: 'draft_requires_human_approval'; body: string } {
  if (!vars.insurer_name || !vars.insurer_name.trim()) {
    throw new Error('insurer_name is required: the insurer name is always a variable, never hardcoded.');
  }
  const t = MESSAGE_TEMPLATES.find((t) => t.id === templateId);
  if (!t) throw new Error(`Unknown template: ${templateId}`);
  return { template_id: templateId, status: 'draft_requires_human_approval', body: t.render(vars) };
}

// Words that must never appear in a claimant message (no accusation, no fraud
// language). Used by tests and by the notification draft endpoint as a guard.
export const FORBIDDEN_WORDING = ['fraud', 'fraudulent', 'scam', 'criminal', 'guilty', 'fake', 'dishonest', 'cheat', 'suspicious person', 'illegal'];

export function wordingProblems(body: string): string[] {
  const lower = body.toLowerCase();
  return FORBIDDEN_WORDING.filter((w) => lower.includes(w));
}
