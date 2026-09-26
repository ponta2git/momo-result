---
name: postmortem
description: Write or review momo-result postmortems and reassess incident follow-ups. Use for incident analysis, not routine debugging or bug fixes.
---

# Postmortem

Produce evidence-based findings and useful decisions about recurrence, within the requested scope.

## Choose the Requested Work

| Request | Reference to use | Complete when |
| --- | --- | --- |
| Write or revise an incident record | [Record template](references/template.md) | The record explains impact, supported findings, uncertainty, and next steps |
| Review an existing postmortem | The specified record and relevant evidence; use the action reference below only for action assessment | Findings, or no material issues, are reported with evidence and uncertainty; edit only if requested |
| Select or reassess follow-ups | [Follow-up actions](references/follow-up-actions.md) | Proposed decisions have reasons and next steps; update records when that is in scope |
| Implement follow-ups | The same action reference and the affected implementation's owning rules | Authorized changes pass required verification and affected tracking is updated within authorized access |

Read only the references needed for the requested work. Analysis can finish with open questions
and follow-ups; distinguish analysis completion, incident recovery, and action completion.

## Evidence and Causality

- Establish impact, affected period, mitigation, and whether impact is ongoing. Tie material
  claims to evidence from the relevant time, revision, run, or environment. Current code or a later
  passing run alone does not establish incident-time behavior; no observed harm is not proof of
  absence outside the observed scope.
- Separate facts, hypotheses, and unknowns, including evidence against a proposed cause. Explain
  the trigger, enabling conditions, and detection or recovery gaps that the evidence supports.
  Examine the information available at the time; do not invent past beliefs or stop at blame.
- For recurrence, inspect relevant prior measures when access is authorized. Distinguish missing
  implementation, an uncovered path, bypass, and ineffective protection. Investigate the same
  mechanism elsewhere only where evidence makes that relevant.
- When guidance contributed, distinguish missing, ambiguous, or inaccessible guidance from a
  correct rule that was not enforced. A documentation change needs that finding, not just an error.

## Boundaries and Delivery

Follow [AGENTS.md](../../../AGENTS.md) for authorization, private access, and reporting a blocker.
For ongoing impact, prioritize authorized stabilization; otherwise identify the immediate recovery
decision and next step. Incident analysis alone does not authorize production changes or access
to unrelated private records.

New incident records belong at `private/post-mortem/YYYY-MM-DD-short-title.md`, unless the user
specifies another private path. Public output must respect the
[postmortem policy](../../../docs/post-mortem/README.md); the automated safety check cannot judge
whether incident details are suitable for publication.

Deliver the requested record, findings, or verified changes. Include material uncertainty and the
next step for unresolved work, with tracking references when used. For changed files, apply the
[change gates](../../../docs/dev-rule.md#4-change-gates); a read-only review does not require
implementation gates or tracker edits.
