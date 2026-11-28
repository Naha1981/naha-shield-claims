// Generates the built-in fictional sample files for the AI workforce screen:
//   public/samples/sample-claim-SYN-FUNERAL-01.pdf
//   public/samples/sample-payment-register.csv
//   public/samples/sample-communications-SYN-FUNERAL-01.json
// All content is SYNTHETIC / FICTIONAL TEST DATA. Run: node scripts/make-workforce-samples.mjs
import { jsPDF } from 'jspdf';
import { mkdirSync, writeFileSync } from 'node:fs';

const LABEL = 'SYNTHETIC / FICTIONAL TEST DATA';

const pdfLines = [
  LABEL,
  '',
  'Claim reference: SYN-FUNERAL-01',
  'Supplier alias: Highveld Dignity Funerals',
  'Invoice / quote reference: INV-HDF-2210',
  'Job / loss reference: LOSS-2026-0412',
  '',
  'Payment request: R58,000.00',
  'Assessed gross / benefit: R60,000.00',
  'Excess applicable to this event: R5,000.00',
  '',
  'Amount 1: R30,000.00',
  'Amount 2: R28,000.00',
  'Footer total incl tax: R59,000.00',
  '',
  'Historical ledger extract: Prior ledger row - Highveld Dignity Funerals,',
  'INV-HDF-2210, R58,000.00 paid 2026-09-14. Status: cleared.',
  '',
  'ASSESSED GROSS note: the assessor captured R60,000.00.',
  'EXCESS APPLICABLE note: the policy extract states R5,000.00.',
];

const doc = new jsPDF({ unit: 'pt', format: 'a4' });
doc.setFont('helvetica', 'normal');
doc.setFontSize(11);
doc.text(pdfLines, 56, 72, { lineHeightFactor: 1.5 });

const csv = [
  'dataset_label,payment_id,claim_id,supplier_alias,invoice_ref,invoice_total_cents,approved_gross_cents,contractual_excess_cents,paid_cents,payment_date,notification_date,loss_date,required_documents,received_documents',
  `${LABEL},PAY-1001,CLM-9001,Highveld Dignity Funerals,INV-HDF-2210,5800000,6000000,500000,5800000,2026-09-14,2026-09-02,2026-08-30,death_certificate|claim_form,death_certificate|claim_form`,
  `${LABEL},PAY-1047,CLM-9001,Highveld Dignity Funerals,INV-HDF-2210,5800000,6000000,500000,5800000,2026-10-02,2026-09-02,2026-08-30,death_certificate|claim_form,death_certificate|claim_form`,
  `${LABEL},PAY-1052,CLM-9007,Ubuntu Care Parlour,INV-UCP-0931,4500000,4000000,250000,4400000,2026-10-19,2026-10-05,2026-09-28,death_certificate|claim_form,death_certificate|claim_form`,
  `${LABEL},PAY-1060,CLM-9011,Cape Metro Funerals,INV-CMF-1102,3200000,3200000,0,3200000,2026-11-03,2026-10-20,2026-10-12,death_certificate|claim_form|bank_proof,death_certificate|claim_form`,
  `${LABEL},PAY-1066,CLM-9014,Eastern Star Parlour,INV-ESP-5540,2750000,2750000,0,2750000,2026-11-20,2026-11-15,2026-08-01,death_certificate|claim_form,death_certificate|claim_form`,
  `${LABEL},PAY-1071,CLM-9018,Tshwane Heritage Parlour,INV-THP-7702,3100000,3100000,0,3100000,2026-11-22,2026-11-18,2026-11-10,death_certificate|claim_form,death_certificate|claim_form`,
].join('\n') + '\n';

const comms = {
  dataset_label: LABEL,
  case_id: 'SYN-FUNERAL-01',
  records: [
    { id: 'msg-1', channel: 'whatsapp', text: `${LABEL}. Good news - we approved the full R65,000.00 for the funeral claim. Payout on Friday.` },
    { id: 'msg-2', channel: 'email', text: `${LABEL}. Confirming there is no excess on this policy, the family pays nothing.` },
    { id: 'msg-3', channel: 'call_transcript', text: `${LABEL}. Caller asked which documents are outstanding; agent confirmed the signed claim form is still needed.` },
  ],
};

mkdirSync('public/samples', { recursive: true });
writeFileSync('public/samples/sample-claim-SYN-FUNERAL-01.pdf', Buffer.from(doc.output('arraybuffer')));
writeFileSync('public/samples/sample-payment-register.csv', csv);
writeFileSync('public/samples/sample-communications-SYN-FUNERAL-01.json', JSON.stringify(comms, null, 2) + '\n');
console.log('samples written');
