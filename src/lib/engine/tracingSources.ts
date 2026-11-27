// Static reference data: South African verification and asset-tracing sources.
// Reference links only. No live connector, lookup or automated check is implemented.
// Free sources come first; official-fee sources are marked so nobody spends by accident.

export type TracingSource = {
  name: string;
  what: string;
  cost: 'Free' | 'Official fee';
  url: string;
  use: string;
};

export const TRACING_SOURCES: TracingSource[] = [
  {
    name: "Master's Deceased Estates Online (DoJ&CD)",
    what: 'Deceased estate file and status: executor, heirs and the reported death record',
    cost: 'Free',
    url: 'https://dojonline.justice.gov.za',
    use: 'Verify a reported death and find the estate file before or after a payout',
  },
  {
    name: 'Government Gazette archive (Gazettes.Africa)',
    what: 'Deceased-estate notices (Forms J187/J29), insolvency and sequestration notices, sale-in-execution notices',
    cost: 'Free',
    url: 'https://gazettes.africa/gazettes/za/',
    use: 'Confirm estate advertising, insolvency and forced-sale notices without a paid search',
  },
  {
    name: 'AuctionWatch sheriff auctions',
    what: 'Upcoming sheriff sales in execution with reserve prices, sourced from Gazette notices',
    cost: 'Free',
    url: 'https://auctionwatch.co.za/sheriff-auctions',
    use: 'Estimate realistic forced-sale (auction) value from comparable reserve prices',
  },
  {
    name: "Master's Trust Beneficial Ownership Register",
    what: 'Trusts, trustees and beneficial owners filed with the Master of the High Court',
    cost: 'Free',
    url: 'https://trustonline.justice.gov.za/Masters',
    use: 'Trace payouts routed through trusts',
  },
  {
    name: 'OpenCorporates (CIPC records)',
    what: 'Company and director search built on public CIPC records',
    cost: 'Free',
    url: 'https://opencorporates.com/registers/237',
    use: 'Find companies and directorships linked to a defendant before paying CIPC fees',
  },
  {
    name: 'DeedsWeb (Deeds Office)',
    what: 'Registered property ownership, bonds and transfer history',
    cost: 'Official fee',
    url: 'https://deedsweb.deeds.gov.za',
    use: 'Confirm registered ownership and bond amounts once a free first pass finds a property lead',
  },
  {
    name: 'CIPC eServices',
    what: 'Official company and close-corporation disclosure documents',
    cost: 'Official fee',
    url: 'https://eservices.cipc.co.za',
    use: 'Certified company documents when a free search shows a business link',
  },
];

export type DeathChecklistStep = {
  step: string;
  detail: string;
  source: string;
  url: string;
  cost: 'Free' | 'Official channel';
};

export const DEATH_VERIFICATION_CHECKLIST: DeathChecklistStep[] = [
  {
    step: '1. Original death report',
    detail: "Require the original DHA-1663 / BI-1663 death report and confirm it with Home Affairs through the insurer's accredited channel. There is no free public online death register.",
    source: 'Department of Home Affairs',
    url: 'https://www.dha.gov.za',
    cost: 'Official channel',
  },
  {
    step: '2. Estate file check',
    detail: "Search the Master's deceased-estate system for an estate file in the reported name and ID. No estate file weeks after a reported death is a review lead, not proof.",
    source: "Master's Deceased Estates Online",
    url: 'https://dojonline.justice.gov.za',
    cost: 'Free',
  },
  {
    step: '3. Gazette notice check',
    detail: 'Search Gazette deceased-estate notices (Forms J187/J29) for the reported deceased and compare executor details against the claimant.',
    source: 'Gazettes.Africa',
    url: 'https://gazettes.africa/gazettes/za/',
    cost: 'Free',
  },
  {
    step: '4. Funeral parlour confirmation',
    detail: 'Contact the funeral parlour named on the claim directly, using a number found independently, and confirm the service took place.',
    source: 'Claim documents',
    url: '',
    cost: 'Free',
  },
  {
    step: '5. Certifying doctor confirmation',
    detail: 'Contact the doctor who certified the death through practice records, not the number on the claim form.',
    source: 'Claim documents',
    url: '',
    cost: 'Free',
  },
  {
    step: '6. Trust payout check',
    detail: "If the payout routes to a trust, look up the trust and its beneficial owners on the Master's register.",
    source: "Master's Trust Beneficial Ownership Register",
    url: 'https://trustonline.justice.gov.za/Masters',
    cost: 'Free',
  },
];
