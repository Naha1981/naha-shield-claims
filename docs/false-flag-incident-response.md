# False-flag incident response plan

From Thabiso's implementation spec, 2026-11-28 (PRD v1.2 section 28). This is
the standing plan the app documents and links to; the kill switch and incident
log in the app exist to execute it.

## Purpose

Ensure that a false flag does not become an unfair delay, wrongful decline,
reputational harm, or regulatory breach.

## Severity levels

| Severity | Definition | Response time |
|---|---|---:|
| S1 - Critical | False flag caused payment delay, wrongful decline, claimant harm, or public exposure | 1 hour |
| S2 - High | False flag affected a material claim or multiple claimants | 4 hours |
| S3 - Medium | False flag identified internally before claimant impact | 1 business day |
| S4 - Low | Isolated false positive with no claimant impact | 3 business days |

## Incident roles

| Role | Responsibility |
|---|---|
| Incident commander | Coordinates response |
| Claims owner | Owns claimant impact and remedy |
| AI/model owner | Owns model or agent failure |
| Compliance officer | Owns POPIA and regulatory assessment |
| Legal | Owns claimant communication and legal exposure |
| Security engineer | Owns technical containment |
| Data engineer | Owns data correction |
| Communications | Owns internal and external messaging |

## Detection triggers

A false-flag incident may be triggered by:

- Claimant appeal upheld.
- Claim released after hold.
- Human override rate exceeds threshold.
- False-positive rate exceeds threshold.
- Complaint alleges unfair treatment.
- Model drift alert.
- Rule misconfiguration.
- Data-quality error.
- Duplicate-match false positive.
- Agent hallucination or incorrect explanation.
- Unauthorised access to evidence.

## Response workflow

1. Detect false flag
2. Classify severity
3. Freeze affected automated action
4. Preserve evidence
5. Assess claimant impact
6. Correct claim status
7. Notify claimant if affected
8. Root-cause analysis
9. Correct rule, model, or data
10. Test fix
11. Resume affected workflow
12. Report and close incident

## Immediate actions (within one hour for S1)

- Disable the affected rule, model, agent, or integration. (The app kill switch.)
- Freeze any pending adverse action.
- Identify all affected claims and claimants.
- Preserve logs, evidence, model inputs, and outputs.
- Notify the incident commander and claims owner.
- Assign a human reviewer to every affected claim.
- Prevent further automated adverse actions.

## Claimant remedy

If a claimant was affected:

- Release the hold immediately if the claim is valid.
- Restore the claim to its correct status.
- Reverse any wrongful reduction or decline.
- Send a neutral apology and explanation.
- Offer expedited processing.
- Record the remedy in the appeal and audit log.
- Do not use wording that implies wrongdoing.

## Root-cause analysis (within five business days)

Document:

- What triggered the false flag.
- Which rule, model, agent, or data source caused it.
- How many claims were affected.
- Whether claimants were harmed.
- Whether money was wrongly withheld, reduced, or declined.
- What control failed.
- What corrective action was taken.
- What preventive control was added.
- Whether the incident must be reported.

## POPIA assessment

If personal information may have been accessed or acquired by an unauthorised
person, the responsible party must notify the Information Regulator and
affected data subjects as soon as reasonably possible. The notification must
explain the compromise, affected information, possible consequences, and
remedial steps.

## Prevention controls

- Every flag requires human review before adverse action.
- Every adverse action requires evidence strength above the configured threshold.
- Every model and rule has a kill switch.
- Every false positive is logged and classified.
- Every appeal overturn triggers root-cause analysis.
- Every model change requires regression testing.
- Every claimant-facing message requires approval.
- Every incident is tracked to closure.
