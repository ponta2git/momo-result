# Follow-up Actions

Use this reference when selecting, implementing, or reassessing actions from a postmortem.
For analysis and authorization boundaries, follow [../SKILL.md](../SKILL.md) and `AGENTS.md`.

Use `private/post-mortem/follow-up-actions.md` as the current plan for outstanding actions.
Read its local conventions when access is authorized. The source postmortem owns the incident
history, original decisions, and completed evidence. If the tracker is absent or unavailable, keep
outstanding actions in the authorized incident record with an explicit tracking location and next
step; do not leave them dependent on creating another document.

## Action Contract

- Keep a stable reference to the source action, such as a section anchor or local action ID.
  Preserve the original priority and decision in the source; update the current target, priority,
  and acceptance condition when justified, recording the date and reason for a changed decision.
- Make an outstanding action executable from its tracking entry: causal purpose, target boundary,
  responsible person/role (a stated shared owner is sufficient), acceptance condition, verification
  method, and next step. A deferred or blocked action also needs its reason and a date or condition
  for reconsideration. Do not invent an assignee, deadline, or approval.
- When reviewing related actions, check whether the target still exists, evidence still applies,
  and a revisit condition has occurred. Connect an event-based trigger to the relevant existing
  work entry point or a named follow-up review. A trigger in a file does not create background
  monitoring or authorize unrelated reads.

## Status and Evidence

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
