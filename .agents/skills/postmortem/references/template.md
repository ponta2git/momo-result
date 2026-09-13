# Private Postmortem Template

Use this structure for a new or revised private incident record. Keep only sections that support
the current analysis. Follow [../SKILL.md](../SKILL.md); when selecting or updating actions, use
[follow-up-actions.md](follow-up-actions.md) for their lifecycle and tracking.
The action table is a dated snapshot; the shared tracker owns the current outstanding plan.
Keep secret values out of this record and publish only abstract lessons.

````md
# Postmortem: <short incident title>

Incident date / period: <date and timezone; mark estimates>
Scope: <affected system and analysis scope>
Incident state: <ongoing | mitigated | recovered | unknown>, as of <time>
Analysis state: <draft | complete for the stated scope>, as of <date>
Follow-up owner: <known responsible person/role; shared unless an action overrides it>
Current follow-ups: <tracking file or source section>

## Summary and Impact

<What failed, what users observed, mitigation, and remaining impact. State the basis and limits of
impact estimates, including data loss or uncertainty.>

## Evidence and Timeline

| When | Observation | Evidence / relevant revision or run |
|---|---|---|
| <time and timezone> | <observed event; label estimates> | <safe source reference> |

## Causal Analysis

<Explain the supported failure mechanism, enabling conditions, and detection/recovery gaps.
Separate hypotheses from facts. Include conflicting evidence and unknowns that affect decisions.
Do not infer the incident-time behavior from the current implementation alone.>

## Prior Measures and Recurrence

<When relevant: link the previous action or safeguard. Was it unimplemented, outside its coverage,
bypassed, or ineffective? What does that imply for the bounded scope of this response?>

## What Helped or Hindered

<Diagnosis, mitigation, recovery, and the information available at the time. Explain whether
requirements or guidance were missing, ambiguous, hard to find, or already correct but unenforced,
only where that contributed.>

## Response Selection

<Connect chosen actions to the findings and expected reduction in likelihood or impact. Explain
material alternatives, costs, and trade-offs, including why an extra test or rule is unnecessary
when that is the decision. Route any required specification decision to its owner.>

## Remediation and Verification Performed

| Change / action ref | Evidence and result | Verified boundary and remaining limits |
|---|---|---|
| <implemented change> | <revision/run/command/manual review reference> | <what it proves and does not prove> |

## Actions at Analysis Completion

As of: <date>. Current outstanding plans are maintained at <tracker reference>.
Use source section anchors or local IDs to keep action references stable.

| Ref | Priority / status | Action and causal purpose | Target / owner override | Done when | Verification method | Next step / revisit condition |
|---|---|---|---|---|---|---|
| <A1> | <priority / status> | <concrete action and intended effect> | <boundary; override shared owner if needed> | <observable acceptance condition> | <suitable evidence> | <next step; reason and trigger if postponed> |

## Open Questions and Residual Risk

<Unverified behavior, unanswered questions, and their investigation/decision action references.
For accepted risk, identify who decided, why, and any review condition. A recorded risk is not
automatically accepted.>

## Durable Guidance Changes

<When needed: link the owning rules and describe the decision they now clarify. An existing
correct rule may need implementation support instead of another documentation change. Keep
lessons.md to applicable recall prompts and pointers.>

## Changed Mental Model

<Optional: a supported misconception and the corrected model. Label an inferred misconception
as a hypothesis; omit this section when the evidence does not support one.>

## Dated Follow-up Results

<Append only when later work changes a conclusion, closes an action, or replaces/withdraws it.
Include the action reference, date, evidence or decision rationale, and replacement if any.
Preserve the original snapshot rather than silently revising incident history.>
````
