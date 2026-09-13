---
name: postmortem
description: Analyze momo-result incidents or serious failures, review postmortems, and reassess follow-up actions. Use for postmortem work, not routine bug fixes.
---

# Postmortem

Reduce the likelihood or impact of recurrence through evidence, appropriate action, and follow-up.
Match the depth of the analysis to the incident and the decisions it needs to support.

## Scope and References

- Preserve the requested scope: a new postmortem, a review, or reassessment of existing actions.
  A review produces findings unless edits were requested. When implementation is authorized,
  carry the selected changes through their required verification.
- Establish whether impact is ongoing. Prioritize authorized stabilization or its handoff before
  extended analysis; a postmortem request alone does not authorize production changes.
- Follow `AGENTS.md` for user intent, authorization, public/private boundaries, and reporting a
  blocker. Incident records belong in `private/post-mortem/` or the user's specified private path;
  a postmortem request does not by itself grant access to private records.
- Use `docs/README.md` when selecting the owning rules or change gates.
- For a new or revised incident record, use [references/template.md](references/template.md).
- When selecting, implementing, or reassessing follow-up actions, read
  [references/follow-up-actions.md](references/follow-up-actions.md). A findings-only review
  needs that reference only if action tracking is part of the review.

## Establish Facts and Causal Findings

- Establish the impact, affected period, mitigation, and remaining uncertainty. Connect important
  claims to source evidence and its time, revision, run, or environment when those distinctions
  affect the conclusion. Current code and a later successful run do not establish what happened
  during the incident. Distinguish no observed harm from verified absence within a stated scope.
- Separate observed facts, causal hypotheses, and unknowns. Explain the trigger, conditions that
  allowed failure or amplified impact, and detection/recovery gaps as relevant. Consider evidence
  against a proposed cause; an unknown cause is an acceptable result. Do not invent a person's or
  agent's past assumptions to fill a narrative. Examine information and constraints available at
  the time instead of stopping at "carelessness" or "should have checked."
- For recurrence or an existing safeguard, consult the relevant earlier record and action when
  access is authorized. Distinguish an unimplemented action, an uncovered path, a bypass, and an
  implemented but ineffective measure. Use that finding to bound investigation of the same failure
  mechanism elsewhere; do not turn one incident into a repository-wide audit by default.
- Check whether the expected behavior was discoverable in the sources implementers were directed
  to use. Treat ambiguity as a contributor only when evidence connects it to the failure.
  Distinguish missing or inaccessible guidance from guidance that existed but was not enforced.
  Examine modes, terminology, side effects, and generated contracts when relevant to that finding.

Incomplete causal knowledge does not prevent a bounded improvement to an observed failure
mechanism. Preserve the uncertainty and identify any investigation needed for the remaining
decision.

## Select and Carry Out Improvements

- Tie each selected action to a causal finding and the outcome it should improve. Compare the
  relevant alternatives: remove or simplify the failure mechanism, constrain unsafe behavior,
  improve detection, limit impact, improve recovery, or change tests, documentation, and workflow.
  Consider expected risk reduction, maintenance cost, existing coverage, and new failure modes.
  Adding a rule or test is not the default outcome.
- Select quality evidence through `docs/test-rule.md` and gates through `docs/dev-rule.md`.
  Carry authorized improvements through verification of the affected boundary, reusing current
  evidence where applicable. Consult `docs/test-architecture.md` when execution design changes.
- If a product or operational decision is unresolved, formulate the decision, responsible
  person/role, and next step. Do not disguise it as an implementation-ready task. Record risk
  acceptance only with its decision-maker and rationale; merely listing a risk is not acceptance.
- Change durable guidance only when a gap or a needed decision rule remains. Resolve ownership
  through `docs/README.md`; do not duplicate its placement tables here. Keep
  `docs/post-mortem/lessons.md` to relevant recall prompts and links. Add an agent instruction only
  when an existing entry point does not already provide the required guidance.

Default new-record path: `private/post-mortem/YYYY-MM-DD-short-title.md`.
Keep the original event and decisions as dated history. Append a dated correction or follow-up
result when later evidence changes a conclusion; do not silently rewrite what was known then.

## Completion

For the requested scope, report the findings and uncertainty, completed changes and evidence,
and outstanding actions with their tracking location and next step. Distinguish recovery of the
incident, completion of the analysis, and completion of follow-ups. Analysis can finish with
explicitly tracked uncertainty and open actions.

Before finishing, verify that the selected actions address the findings, the current plan and
source references agree, relevant lessons were considered, and changed files passed their
applicable gates. Review public/private placement as well as automated safety checks. Do not
claim implementation or verification that was outside the work performed.
