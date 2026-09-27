# Private Postmortem Template

Adapt this structure to the requested private record; omit sections that do not support a decision.
Keep secret values out. Preserve the event and original decisions as dated history; append dated
corrections when later evidence changes a conclusion instead of silently rewriting what was known.

When selecting or updating actions, use [follow-up-actions.md](follow-up-actions.md). An action
list here is a dated snapshot when an authorized shared tracker holds the current plan; otherwise
this record can hold the plan. A tracker is not a prerequisite for completing the analysis.

````md
# Postmortem: <short incident title>

Incident date / period: <date and timezone; mark estimates>
Scope: <affected system and analysis scope>
Incident state: <ongoing | mitigated | recovered | unknown>, as of <time>
Analysis state: <draft | complete for the stated scope>, as of <date>

## Summary and Impact

<What failed, what users observed, mitigation, remaining impact, and the basis and limits of the
impact estimate. Distinguish unknown impact from verified absence of harm.>

## Evidence and Timeline

| When | Observation | Evidence / relevant revision or run |
|---|---|---|
| <time and timezone> | <observed event; label estimates> | <safe source reference> |

## Findings and Uncertainty

<Explain the supported failure mechanism and contributing conditions, linking evidence. Separate
facts, hypotheses, conflicting evidence, and unknowns. Include prior measures, information gaps,
and factors that helped or hindered recovery when they explain a finding or response decision.>

## Response and Verification

<Connect selected responses to findings and intended outcomes. Explain material alternatives and
trade-offs. Link any changed durable guidance to its owning source. Record unresolved product or
operational decisions with their known owner or mark them unassigned; do not present them as
implementation-ready tasks.>

| Change / action ref | Evidence and result | Verified boundary and remaining limits |
|---|---|---|
| <completed work> | <revision/run/command/manual review reference> | <what it proves and does not prove> |

## Follow-ups and Residual Risk

As of: <date>. Current plan: <authorized tracker or this section>.
Shared owner, if known: <person/role; override per action when needed>.

- <Stable action ID, priority, status>: <action or decision and causal purpose>
  - Target / owner: <affected boundary; owner override or unassigned>
  - Completion evidence: <observable acceptance condition and verification method>
  - Next step: <work needed; reason and revisit date/condition if deferred or blocked>

<Connect material unknowns and residual risks to these actions. For accepted risk, identify the
decision-maker, rationale, and any review condition; merely recording a risk is not acceptance.>

## Dated Follow-up Results

<When later work changes a conclusion or action, append its date, reference, evidence or decision
rationale, and replacement if any. Keep the current plan synchronized when an update is authorized.>
````
