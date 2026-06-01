# Private Postmortem Template

Use this template as a starting point for `private/post-mortem/`. Keep only sections that help the
current incident. Do not copy incident-specific details into public `docs/` unless the user
explicitly approves a sanitized public summary.

```md
# Postmortem: <short incident title>

Date: YYYY-MM-DD

Scope: <system/component/repo>

Status: <mitigated | resolved | follow-up actions open>

## Summary

<What failed, what users observed, and the short version of why.>

## Impact

- <User-visible impact>
- <Operational impact>
- <Data loss or explicit "No data loss observed">

## Timeline

- <timestamp timezone>: <event>

## Root Causes

### 1. <root cause>

<Explain the systemic cause, not only the immediate bug.>

## Contributing Factors

- <Detection gap>
- <Testing gap>
- <Specification/documentation gap>
- <Process or mental model issue>

## Test Architecture Assessment

<Identify which test layer should have caught the issue and whether current tests cover the exact
failing path.>

| Layer | Responsibility | Current gap | Needed change |
|---|---|---|---|

## What Worked

- <What made diagnosis or mitigation easier>

## What Did Not Work

- <What let the issue escape>

## Immediate Remediation Completed

- <Fix or mitigation already done>

## Residual Risk

- <What remains unverified or unimplemented>

## Follow-up Actions

| Priority | Action | Target | Done when | Verification |
|---|---|---|---|---|
| P0 | <action> | <file/module> | <acceptance condition> | <command/test/review> |

## Changed Mental Model

Replace:

```text
<old assumption>
```

With:

```text
<new operating model>
```

## Rules To Move

| Lesson | Durable home |
|---|---|
| <stable rule> | <docs/*-rule.md or AGENTS.md> |
```

## Review Prompts

- Does each action have a target, done condition, and verification?
- Are durable rules moved to their proper docs instead of staying only in the postmortem?
- Is `docs/post-mortem/lessons.md` only an entry point, not a duplicate rulebook?
- Does the test plan execute the actual failing path?
- Are skipped integration tests reported as unverified behavior?
- Does the document challenge the mental model that let the issue pass?
- Are timeline facts separated from inference?
- Is any public doc update sanitized for the repository's public/private boundary?
- Is any recommendation vague enough that the next agent could ignore it?
