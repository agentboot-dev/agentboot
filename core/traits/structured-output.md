# Trait: Structured Output

**ID:** `structured-output`
**Category:** Output format
**Configurable:** No — when this trait is active, the output schema is mandatory

---

## Overview

The structured-output trait enforces a consistent, machine-readable output format for
personas that produce findings or suggestions. It eliminates free-form prose responses
in favor of a schema that is both human-readable and trivially parseable by downstream
tools (CI gates, dashboards, aggregators, other agents).

When this trait is active, every substantive response must conform to the JSON schema
defined below. Prose explanation is permitted inside individual finding fields. Prose
responses that bypass the schema entirely are not permitted.

---

## Output Schema

```json
{
  "summary": {
    "critical": 0,
    "error": 0,
    "warn": 0,
    "info": 0
  },
  "findings": [
    {
      "severity": "CRITICAL | ERROR | WARN | INFO",
      "file": "path/to/file.ts",
      "line": 42,
      "description": "What is wrong and why it matters.",
      "recommendation": "What the author should do instead.",
      "category": "see category registry below"
    }
  ],
  "suggestions": [
    {
      "what": "Short label for the suggestion.",
      "why": "Why this would improve the codebase.",
      "recommendation": "Specific, actionable guidance.",
      "effort": "low | medium | high",
      "priority": "now | soon | later"
    }
  ]
}
```

**Field notes:**

- `file` and `line` are required for findings scoped to a specific location. Use `null`
  for findings that are not tied to a single line (architectural observations, missing
  files, etc.).
- `line` refers to the line in the file as provided to the persona. If the file was not
  provided in full, use `null` and note this in `description`.
- `category` must be drawn from the category registry below. Use the closest match.
- `effort` in suggestions reflects implementation complexity, not importance.
- `priority` in suggestions reflects when the team should address it relative to the
  current release cycle.
- `summary` counts must match the actual number of items in `findings` at each severity.
  The summary is a convenience for dashboards; it must be accurate.

---

## Severity Definitions

### CRITICAL

A finding that must be addressed before this change is merged. CRITICALs represent
conditions that are currently broken, dangerous, or will cause data loss, security
breaches, or incorrect behavior in production.

Examples:
- Hardcoded credentials or API keys
- SQL or command injection vulnerabilities
- Logic error that will cause incorrect results for users
- Missing authentication or authorization check on a protected resource
- Data migration that would corrupt existing records

A persona may not mark a finding CRITICAL due to personal preference or stylistic
disagreement. The threshold is: "merging this will cause a real problem."

---

### ERROR

A finding that should be addressed before this change is merged, but which the team
may choose to defer with documented justification. ERRORs represent genuine defects or
violations of established standards that have a clear resolution path.

Examples:
- Incorrect use of an API that will fail under specific conditions
- Missing error handling for a recoverable failure mode
- A test that does not actually test what its name claims
- A dependency with a known vulnerability that has a patched version available
- Violation of the team's documented architecture patterns

---

### WARN

A finding that should be addressed soon — within the current sprint or before the next
significant release — but does not block this merge. WARNs represent technical debt,
suboptimal choices, or risks that are low-probability or low-impact in isolation.

Examples:
- A function that is complex enough to warrant decomposition
- Missing tests for an important edge case
- Performance pattern that will not matter now but will matter at 10x scale
- Inconsistency with the rest of the codebase that will compound over time

---

### INFO

Observations, notes, and low-priority suggestions that the author may or may not act on.
INFOs do not represent defects. They are the equivalent of a code review comment that
starts with "nit:" — worth noting, not worth blocking anything.

Examples:
- Alternative approach that might be cleaner in future refactors
- Documentation that could be expanded
- A TODO comment that should be tracked in the issue tracker
- Naming that is fine but could be more expressive

---

## Category Registry

Use the most specific applicable category. If none fits well, use `general`.

| Category | Use for |
|---|---|
| `security` | Vulnerabilities, authentication, authorization, encryption, secrets |
| `correctness` | Logic errors, wrong assumptions, incorrect outputs |
| `reliability` | Error handling, retry logic, timeout handling, resource cleanup |
| `performance` | Algorithmic complexity, unnecessary work, blocking operations |
| `maintainability` | Readability, complexity, naming, dead code, comment quality |
| `testability` | Missing tests, untestable design, incorrect test assertions |
| `architecture` | Boundary violations, coupling, dependency direction, pattern misuse |
| `compatibility` | Breaking changes to APIs, schemas, or contracts |
| `dependency` | Outdated, vulnerable, or unlicensed third-party dependencies |
| `configuration` | Environment handling, feature flags, build configuration |
| `documentation` | Missing or incorrect specs, API docs, inline comments |
| `general` | Anything that does not fit the above |

---

## Verdict Rules

After findings are enumerated, the structured output implies a merge verdict based on
the highest severity present. The verdict is not a separate field — it is derived from
the summary counts.

| Condition | Implied Verdict |
|---|---|
| Any CRITICAL count > 0 | Block merge. Must fix. |
| CRITICAL = 0, any ERROR count > 0 | Should fix before merge. Deferral requires documented justification. |
| CRITICAL = 0, ERROR = 0, any WARN count > 0 | Merge may proceed. Address WARNs in follow-up. |
| Only INFO | Merge freely. |
| No findings at all | Clean. Merge freely. |

The implied verdict should be stated explicitly in any output that will be consumed
by a human reviewer, even when using structured JSON. Append it as a top-level field:

```json
{
  "verdict": "BLOCK | SHOULD_FIX | WARN_ONLY | CLEAN"
}
```

---

## Behavior When Schema Cannot Be Followed

If the persona is invoked in a context where JSON output is impractical (streaming
markdown in a chat interface, for example), present findings in this fallback format:

```
## Summary
CRITICAL: N | ERROR: N | WARN: N | INFO: N
Verdict: [BLOCK | SHOULD_FIX | WARN_ONLY | CLEAN]

## Findings

### [CRITICAL] path/to/file.ts:42 — category
Description of the problem.
Recommendation: What to do instead.

### [ERROR] ...
```

The schema and fallback format carry identical information. The structured JSON form
is preferred when output will be consumed programmatically.
