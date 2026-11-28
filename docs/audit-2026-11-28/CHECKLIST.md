# ClaimTrace enterprise frontend audit - build checklist (28 Nov 2026)

Source: Thabiso's pasted audit (WhatsApp 11:46) + order 11:56 to build all six phases.
Status legend: DONE (with proof) / IN PROGRESS / NOT DONE. Every DONE links to proof (release, screenshot, CI run).

## Phase 1 - Critical UX defects
- [DONE] Route registry defect: /investigator and /see-worked-case-example (incl. nested case route) missing from the parser's valid list; reload/back/forward falls to overview. One route source of truth consumed by parser and navigation.
- [DONE] Public map page shows private-tool sign-in error -> clean "signed-in reviewer tool" card with guided-sample link (HostedExecutionPanel visitor state; commit 37aecd6d).
- [DONE] AI page broken/unexplained for visitors (his 11:48 order): sample files built in, sign-in collapsed, voice commands work (37aecd6d).
- [ ] Four distinct capture states wording on map page: captured locally / downloaded / submitted for review / sealed in Evidence Vault.
- [ ] Lead cards show real status and next action instead of one generic Review badge (RelationshipGraph leads).
- [ ] Interactive graph: clickable nodes/edges, zoom, pan, reset, legend, neighbour-limit note (mockup for Go+Sure first? NO - his 11:56 order builds it on the RC branch).
- [ ] Remove duplicate/confusing actions.

## Phase 2 - Core workspace redesigns (RC branch)
- [ ] Relationships: three-panel workspace (search/filters | interactive graph | selected entity/evidence), leads queue at bottom, right panel becomes drawer on small screens.
- [ ] Address Evidence: focused evidence workspace, compact collapsed gallery, title "Public Map Context Review".
- [ ] Claims investigation workspace.
- [ ] Evidence Vault workspace.
- [ ] Move death verification into claims verification workflow; move DB/methodology detail into a system-information view.

## Phase 3 - Design system (RC branch)
- [ ] Design tokens: consolidate to ClaimTrace namespace (forest-green identity kept); WCAG AA checks.
- [ ] Typography consolidation: Inter UI + JetBrains Mono for ids/hashes; retire DM Sans / Plus Jakarta Sans declarations.
- [ ] Component standards: spacing scale, input/button heights, radii, borders; tables where tables communicate better.
- [ ] Semantic colour discipline; never colour alone for risk.
- [ ] Reduced-motion preserved; no decorative animation.

## Phase 4 - Enterprise UX (RC branch)
- [ ] Case-centred pattern across Claims/Evidence/Relationships/Consent/Investigation/Recovery (record header + 5-step progression).
- [ ] Grouped navigation (Overview / Claims operations / Intelligence & evidence / Financial recovery / Governance); remove redundant map buttons from headers.
- [ ] Global search for claims, entities, evidence refs; consistent filters; last-updated timestamps.
- [ ] Meaningful empty states; confirmation dialogs; unsaved-changes indicators; activity history with named reviewer; persistent synthetic/simulated/verified indicator.
- [ ] Keyboard operation: graph, tables, menus, dialogs, forms; clickable rows keyboard-accessible.

## Phase 5 - Engineering quality
- [DONE] ESLint actually runs in CI (bug rules + react-hooks; typescript 6.0.3 for parser compat; 0 errors, warnings only) - commit 37aecd6d, ci.yml "ESLint" step.
- [ ] Playwright browser regression: route refresh (incl. /investigator deep link), theme switch, claims search, open relationship, inspect evidence, capture map, module navigation, keyboard nav. Minimum per parent 11:46: route refresh + theme switch.
- [ ] Refactor compressed components: RelationshipGraph.tsx, PublicMapPreview.tsx, HostedExecutionPanel.tsx (split, separate logic/presentation).
- [ ] CSS consolidation (retire --ns-* experiments into --ct-* tokens).
- [ ] Performance: LCP/INP/CLS measured on the deployed app; lazy-load MapLibre/heavy modules where justified.

## Phase 6 - Final presentation
- [ ] Consistent demonstration data; demo/authenticated experiences properly separated.
- [ ] Executive overview review; clear system limitations.
- [ ] Full screenshot QA set (phone + desktop, light + dark, every screen) sent for Go + Sure before RC merges to main.

## Standing release rules (apply to every release)
- Rollback tag = current main at merge time, freshly tagged.
- Cold phone-width (400px) first frames, light and dark, attached to the report.
- Old-name grep on pre-boot HTML/meta/titles/static pages: NahaShield, sandbox, Demo.
- Free/open-source only; SAMPLE labels; live connectors off; no real data.

## Additions from 12:03 review (parent-relayed, Thabiso 12:03)
- [ ] Per-claim Class A/B/C tag in the live ledger (today: only in the worked-example fee model) — free/open-source, SAMPLE labels
- [ ] Exportable FSCA compliance report (PDF) from the compliance screen
- [x] Approval gate wording kept as is (decision: no change)
- Rule: never claim WORM or Merkle unless actually built (vault = SHA-256 hash chain, SQLite-backed)

## Addition from 12:05 (Thabiso via parent: "Make sure this software archives that. RAND FOUND IN THEIR OWN CLAIMS AND THAT WE CAN PROTECT.")
- [ ] One-page "Rand found" summary per insurer dataset: total rand found, rand protected/recoverable, claims list with evidence; sealed in the evidence vault; archived with date; exportable as PDF; headline number on the Savings/Value screen. SAMPLE labels on sample data, integer cents, no fake real-insurer claims. (Build approved 12:05; merge still needs Go+Sure on the tested candidate.)
