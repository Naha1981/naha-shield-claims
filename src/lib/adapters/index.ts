export interface SimulatedAdapterMeta {
  adapter_id: string;
  name: string;
  badge: 'SIMULATED ADAPTER (INSURER CREDENTIALS REQUIRED IN PROD)';
  module: 'M1' | 'M2' | 'M3';
  lawful_basis: string;
  degrades_to: string;
}

export const ADAPTER_INVENTORY: SimulatedAdapterMeta[] = [
  {
    adapter_id: 'windeed_deeds_cipc',
    name: 'Deeds / WinDeed / CIPC Registry Trace',
    badge: 'SIMULATED ADAPTER (INSURER CREDENTIALS REQUIRED IN PROD)',
    module: 'M1',
    lawful_basis: 'POPIA s11(1)(f) Legitimate Interest (Post-Fraud Recovery)',
    degrades_to: 'Manual deeds & CIPC trace upload',
  },
  {
    adapter_id: 'dha_verifynow',
    name: 'DHA / VerifyNow Living-Person Signal',
    badge: 'SIMULATED ADAPTER (INSURER CREDENTIALS REQUIRED IN PROD)',
    module: 'M3',
    lawful_basis: 'PPR Rule 2A.8 Claim Verification Mandate',
    degrades_to: 'Manual call-centre living-person callback',
  },
  {
    adapter_id: 'bankserv_avsr',
    name: 'BankservAfrica AVS-R & DebiCheck',
    badge: 'SIMULATED ADAPTER (INSURER CREDENTIALS REQUIRED IN PROD)',
    module: 'M3',
    lawful_basis: 'Pre-EFT Account Ownership & Payer Mandate Verification',
    degrades_to: 'Manual bank confirmation letter check',
  },
  {
    adapter_id: 'xtnd_astute',
    name: 'XTND / Astute / ICB Exports',
    badge: 'SIMULATED ADAPTER (INSURER CREDENTIALS REQUIRED IN PROD)',
    module: 'M3',
    lawful_basis: 'Insurer-Licensed Fraud & Policy Register Feed',
    degrades_to: 'Batch CSV export reconciliation',
  },
  {
    adapter_id: 'whatsapp_ussd_gateway',
    name: 'WhatsApp Business & USSD Consent Gateway',
    badge: 'SIMULATED ADAPTER (INSURER CREDENTIALS REQUIRED IN PROD)',
    module: 'M2',
    lawful_basis: 'POPIA s11(1)(a) & PPR Third-Party Consent Capture',
    degrades_to: 'Recorded outbound verification callback queue',
  },
];

export function simulateIndependentContactLookup(
  policyId: string,
  hasIndependentOnFile: boolean,
) {
  return {
    adapter: 'CRM / KYC Bureau Contact Lookup',
    badge: 'SIMULATED ADAPTER (INSURER CREDENTIALS REQUIRED IN PROD)',
    policy_id: policyId,
    independent_contact_on_file: hasIndependentOnFile,
    source: hasIndependentOnFile ? 'KYC Bureau / CRM Primary' : 'Applicant-Supplied Only',
  };
}
