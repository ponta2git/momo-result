---
name: postmortem
description: Create or review momo-result incident postmortems, analyze outages/bugs/regressions/verification misses, extract durable lessons, keep private incident detail out of public docs, update docs/post-mortem/lessons.md, and move stable rules into AGENTS.md, dev-rule.md, test-rule.md, db-rule.md, domain-rule.md, architecture.md, or the owning requirement/contract doc.
---

# Postmortem

Use this skill to convert an incident or verification miss into durable engineering practice for
this repository. The goal is recurrence reduction: better tests, quality gates, operating rules,
documentation, and AI-facing instructions.

## Repository Boundary

- This repository is public by default.
- Put incident-specific detail, timelines, provider facts, runbooks, measured values, attack
  observations, and residual risks in `private/post-mortem/` unless the user explicitly requests a
  different private path.
- Keep public `docs/post-mortem/lessons.md` short: reflection prompts and links to durable rules
  only.
- Do not put secrets, tokens, DB/Redis URLs, origin lock tokens, session/CSRF/OAuth values, provider
  configuration, or exploit-ready operational detail in public docs.

## Workflow

1. Gather facts.
   Read only the relevant logs, diffs, tests, docs, and commands. Separate observed facts from
   inference. Record what was verified and what remains unverified.

2. Write or update the postmortem.
   Default path is `private/post-mortem/YYYY-MM-DD-short-title.md`. Include impact, timeline, root
   causes, contributing factors, what worked, what did not, residual risk, and follow-up actions.
   If the user asks for a public document, strip incident-specific and operationally sensitive
   detail and keep only abstract lessons.

3. Evaluate specification and documentation quality.
   Check whether requirements, domain rules, architecture docs, API docs, contracts, or code
   comments made the correct behavior discoverable. If ambiguous terms, implicit modes, optional
   fields with hidden side effects, missing discriminators, stale docs, or implementation-only
   contracts contributed, record that as a cause and move durable clarification to the owning docs.

4. Sync follow-up tracking.
   If `private/post-mortem/follow-up-actions.md` exists, copy new or changed actions there. Preserve
   original wording, source postmortem, original priority, target, done condition, and verification
   method. Re-evaluate still-open actions and keep unresolved items ordered by current priority.
   Mark actions as `Done` only with concrete evidence.

5. Review the improvements.
   Check whether actions are sustainable, not ad hoc, and aimed at the mental model that let the
   issue pass. Identify which test layer should catch the issue and whether a nearby test is being
   used as a substitute for the real failing path.

6. Move durable rules out of the postmortem.
   Stable rules belong in the appropriate project docs, not only in a postmortem.

7. Keep `lessons.md` as an entry point.
   If `docs/post-mortem/lessons.md` needs an update, add only when-to-remember prompts and pointers
   to durable rules. Do not duplicate dev/test/db/domain/architecture rules there.

8. Update AI operating instructions when needed.
   If future agents must check a lesson before quality gates or completion, update `AGENTS.md` or
   the equivalent project agent instructions.

9. Final check.
   Verify docs are concise and MECE: no duplicated rule ownership, no unclear action owner, no
   vague action without an acceptance condition, and no public/private boundary leak.

## Rule Placement

| Lesson type | Durable home |
|---|---|
| Incident detail, timeline, residual risk | `private/post-mortem/*.md` |
| Short reflection prompts and links to rules | `docs/post-mortem/lessons.md` |
| AI workflow, required pre-completion checks | `AGENTS.md` |
| Business requirements, MVP scope, CSV/TSV | `docs/requirements/base.md` |
| Series comparison requirements | `docs/requirements/series-comparison.md` |
| DB ownership, migrations, schema contracts | `docs/db-rule.md` |
| Domain definitions, lifecycle, invariants | `docs/domain-rule.md` |
| Redis Streams / OCR queue contracts | `docs/redis-streams-ocr-contract.md` |
| Test layers, quality gates, verification policy | `docs/test-rule.md` |
| Coverage, test sizes, CI artifacts | `docs/test-architecture.md` |
| Local setup and command sequences | `docs/dev-rule.md` |
| Architecture, API patterns, security rules | `docs/architecture.md` |

## Follow-up Actions

Action items should be executable without re-reading the whole postmortem. Prefer this shape:

| Priority | Action | Target | Done when | Verification |
|---|---|---|---|---|

Each action needs a target file/module, an acceptance condition, and a verification method. If that
is not possible, mark it as a design decision or residual risk instead of pretending it is ready.

## Test Architecture Check

Ask which layer should have caught the issue:

- DB contract: missing tables, columns, seed data, nullability, defaults.
- Repository/integration: SQL syntax, filters, ordering, transactions, database-specific behavior.
- HTTP/API: request parsing, auth, response encoding, error mapping.
- Usecase/unit: domain branching, validation, state transitions.
- Frontend component/page: UI state, user interaction, API error display.
- OCR worker: parser, payload validation, job lifecycle, native OCR boundary.
- E2E smoke: core cross-service flows.

If the proposed test does not execute the failing path, say so and add the direct test or record the
remaining risk.

## Specification and Documentation Check

Ask whether the expected behavior was clearly recoverable from the docs implementers were told to
use. Treat specification and documentation as part of the system.

Evaluate at least these questions:

- Did the relevant requirements/domain/API docs explicitly name the behavior that failed?
- Were there multiple valid modes or paths, and was the discriminator between them documented?
- Did optional fields have side effects or lifecycle meaning that were only visible in code?
- Were similar terms easy to confuse, such as provenance ids versus lifecycle/workflow ids?
- Did a generated type or OpenAPI schema expose a field without explaining when it is required?
- Did tests encode the documented contract, or only the implementation's current shape?
- Should the durable fix live in requirements, domain rules, architecture rules, API docs, test
  rules, queue contracts, DB rules, or agent instructions?

When docs were ambiguous, avoid framing the incident only as an implementation miss. Add a root cause
or contributing factor for the spec gap, update the owning docs, and add a follow-up action if the
docs cannot be fixed immediately.

## References

For a reusable private postmortem structure and wording prompts, read `references/template.md` only
when writing or revising an actual postmortem.
