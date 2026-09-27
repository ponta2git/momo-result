# Follow-up Actions

Use this reference for selecting, reassessing, or implementing incident follow-ups. Preserve
whether the user requested findings, record updates, or implementation, and reuse authorization
already established in the conversation.

## Select a Useful Response

- Tie an action to a supported failure mechanism and an observable outcome. Incomplete causal
  knowledge can still support a bounded improvement; retain uncertainty that affects the decision.
- Compare relevant alternatives by risk reduction, maintenance cost, existing coverage, and new
  failure modes. Removing or constraining the mechanism, improving detection, limiting impact,
  and improving recovery may be more useful than adding a test, rule, or workflow step.
- Keep unresolved product or operational choices as decision tasks with a next step. Identify a
  known decision-maker or mark the owner unresolved; do not invent an assignee, deadline, or approval.
- Change durable guidance only for a remaining gap. Use the owning source in
  [docs/README.md](../../../../docs/README.md); keep lesson cards to recall prompts and links.
  An existing correct rule may need implementation support rather than another instruction.

## Track the Current Plan

When access is authorized, `private/post-mortem/follow-up-actions.md` holds the current outstanding
plan; use its local conventions. The source postmortem holds incident history, original decisions,
and completed evidence. If the tracker is absent or unavailable, use the authorized incident record
or review output, identifying the next step and tracking location. Do not create a tracker merely
to satisfy this reference.

- Keep a stable reference to the source action, such as a section anchor or local action ID.
  Preserve the original priority and decision in the source; update the current target, priority,
  and acceptance condition when justified, recording the date and reason for a changed decision.
- Make an outstanding action executable from its tracking entry: causal purpose, target boundary,
  responsible person/role (a stated shared owner is sufficient), acceptance condition, verification
  method, and next step. Identify any missing owner or decision as unresolved. A deferred or blocked
  action also needs its reason and a date or condition for reconsideration.
- When reviewing related actions, check whether the target still exists, evidence still applies,
  and a revisit condition has occurred. Connect an event-based trigger to the relevant existing
  work entry point or a named follow-up review. A trigger in a file does not create background
  monitoring or authorize unrelated reads.

## Implement and Close

Carry authorized changes through the affected boundary's verification. Choose evidence through
[docs/test-rule.md](../../../../docs/test-rule.md) and required gates through
[docs/dev-rule.md](../../../../docs/dev-rule.md#4-change-gates), including their stop and rerun
conditions. Use `docs/test-architecture.md` only when changing test execution design.

- Distinguish `Open` (work or verification remains), `Deferred` (a stated decision/condition
  postpones work), and `Done` (the acceptance condition is evidenced). Use `Closed` for a
  withdrawn, superseded, or explicitly accepted-risk action, recording that disposition and
  rationale rather than claiming implementation. Accepted risk requires its decision-maker and
  rationale; identify the replacement for a superseded action.
- A completion statement must point to evidence of the acceptance condition, including its scope
  and result. A bare status label is not verification. Record manual review as manual review and
  distinguish a one-time result from reusable automated coverage. Keep material verification gaps
  open, with a next verification step; do not require indefinite observation for an otherwise
  evidenced action.
- When record updates are authorized, synchronize the selected plan and source references. Keep
  completed history in its source, with at most a concise coverage summary in the tracker. A
  findings-only review reports proposed changes without editing either record. Do not maintain two
  live copies of the same plan or re-evaluate unrelated backlog on every incident.
