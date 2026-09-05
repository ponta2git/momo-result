---
name: postmortem
description: Analyze or review momo-result incidents, serious mistakes, and repeated failures; reassess follow-up actions; and verify authorized improvements. Also use for explicitly requested postmortems. Routine bug fixes alone do not require this workflow.
---

# Postmortem

Reduce the likelihood or impact of recurrence through evidence, appropriate action, and follow-up.
Match the depth of the analysis to the incident and the decisions it needs to support.

## Scope and Repository Boundary

- Preserve the requested scope: a new postmortem, a review, or reassessment of existing actions.
  A review produces findings unless edits were requested. When implementation is authorized,
  carry the selected changes through their required verification.
- Establish whether impact is ongoing. Prioritize authorized stabilization or its handoff before
  extended analysis; a postmortem request alone does not authorize production changes.
- Follow `AGENTS.md` and use `docs/README.md` to find the relevant owners, executable sources, and
  change gates. Read only the documents needed for the analysis or selected changes.
- This repository, including this skill, is public. Keep incident detail, timelines, provider
  facts, measurements, runbooks, and residual risks in `private/post-mortem/`, or another private
  path specified by the user. Read private material only when authorized and relevant; authorization
  already given for this task remains valid.
- Never copy secret values into documents, tool output, commits, PRs, or chat. Public output may
  contain abstract lessons and durable rules, but not incident-specific operational detail.

## Establish Facts and Causal Findings

1. Establish the impact, affected period, mitigation, and remaining uncertainty. Connect important
   claims to source evidence and its time, revision, run, or environment when those distinctions
   affect the conclusion. Current code and a later successful run do not establish what happened
   during the incident. Distinguish no observed harm from verified absence within a stated scope.
2. Separate observed facts, causal hypotheses, and unknowns. Explain the trigger, conditions that
   allowed failure or amplified impact, and detection/recovery gaps as relevant. Consider evidence
   against a proposed cause; an unknown cause is an acceptable result. Do not invent a person's or
   agent's past assumptions to fill a narrative. Examine information and constraints available at
   the time instead of stopping at "carelessness" or "should have checked."
3. For recurrence or an existing safeguard, consult the relevant earlier record and action when
   access is authorized. Distinguish an unimplemented action, an uncovered path, a bypass, and an
   implemented but ineffective measure. Use that finding to bound investigation of the same failure
   mechanism elsewhere; do not turn one incident into a repository-wide audit by default.
4. Check whether the expected behavior was discoverable in the sources implementers were directed
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
- Select quality evidence through `docs/test-rule.md`, its design through
  `docs/test-architecture.md` when needed, and gates through `docs/dev-rule.md`. For chosen evidence,
  execute the failing boundary and judge the affected result; neighboring tests, mocks, or
  successful compilation do not prove a path they did not exercise. Reuse, replace, or remove
  evidence when justified rather than requiring a new test for every action.
- If a product or operational decision is unresolved, formulate the decision, responsible
  person/role, and next step. Do not disguise it as an implementation-ready task. Record risk
  acceptance only with its decision-maker and rationale; merely listing a risk is not acceptance.
- Implement and verify the selected changes within the user's authorization. Use existing
  verification evidence when it applies to the current target; do not rerun unrelated gates merely
  to rebuild historical evidence.
- Change durable guidance only when a gap or a needed decision rule remains. Resolve ownership
  through `docs/README.md`; do not duplicate its placement tables here. Keep
  `docs/post-mortem/lessons.md` to relevant recall prompts and links. Add an agent instruction only
  when an existing entry point does not already provide the required guidance.

For a new or revised incident record, use [references/template.md](references/template.md).
Default new-record path: `private/post-mortem/YYYY-MM-DD-short-title.md`.
Keep the original event and decisions as dated history. Append a dated correction or follow-up
result when later evidence changes a conclusion; do not silently rewrite what was known then.

## Maintain Follow-up Actions

Use `private/post-mortem/follow-up-actions.md` as the current plan for outstanding actions.
Read its local conventions when working on follow-ups. The source postmortem owns the incident
history, original decisions, and completed evidence. If the tracker is absent or unavailable, keep
outstanding actions in the authorized incident record with an explicit tracking location and next
step; do not leave them dependent on creating another document.

After selecting, implementing, or reassessing an action:

- Keep a stable reference to the source action, such as a section anchor or local action ID.
  Preserve the original priority and decision in the source; update the current target, priority,
  and acceptance condition when justified, recording the date and reason for a changed decision.
- Make an outstanding action executable from its tracking entry: causal purpose, target boundary,
  responsible person/role (a stated shared owner is sufficient), acceptance condition, verification
  method, and next step. A deferred or blocked action also needs its reason and a date or condition
  for reconsideration. Do not invent an assignee, deadline, or approval.
- When reviewing related actions, check whether the target still exists, evidence still applies,
  and a revisit condition has occurred. Connect an event-based trigger to the relevant existing
  work entry point or a named follow-up review. Respect private-access boundaries; a trigger in a
  file does not create background monitoring or authorize unrelated reads.
- Distinguish `Open` (work or verification remains), `Deferred` (a stated decision/condition
  postpones work), and `Done` (the acceptance condition is evidenced). Use `Closed` for a
  withdrawn, superseded, or explicitly accepted-risk action, recording that disposition and
  rationale rather than claiming implementation. Identify the replacement when there is one.
- A completion statement must point to evidence of the acceptance condition, including its scope
  and result. A bare status label is not verification. Record manual review as manual review and
  distinguish a one-time result from reusable automated coverage. Keep material verification gaps
  open, with a next verification step; do not require indefinite observation for an otherwise
  evidenced action.
- Synchronize the final selected plan after review and implementation. Keep completed history in
  its source, with at most a concise coverage summary in the tracker. Do not maintain two live
  copies of the same action plan or re-evaluate unrelated backlog on every incident.

## Completion

For the requested scope, report the findings and uncertainty, completed changes and evidence,
and outstanding actions with their tracking location and next step. Distinguish recovery of the
incident, completion of the analysis, and completion of follow-ups. Analysis can finish with
explicitly tracked uncertainty and open actions.

Before finishing, verify that the selected actions address the findings, the current plan and
source references agree, relevant lessons were considered, and changed files passed their
applicable gates. Review public/private placement as well as automated safety checks. Do not
claim implementation or verification that was outside the work performed.
