# AgentBoot Persona Registry

This file is the authoritative registry of all personas shipped with AgentBoot core.
It is generated automatically by `npm run build` — do not edit it manually.
If this file is out of date, run `npm run build` and commit the result.

---

## V1 Personas

| Persona | ID | Invocation | Scope | Traits Composed | IDE Available |
|---|---|---|---|---|---|
| Code Reviewer | `code-reviewer` | `/review-code` | PR / file | critical-thinking (MEDIUM), structured-output, source-citation, confidence-signaling | Yes |
| Security Reviewer | `security-reviewer` | `/review-security` | PR / file | critical-thinking (HIGH), structured-output, source-citation, confidence-signaling, audit-trail | Yes |
| Test Generator | `test-generator` | `/gen-tests` | file | schema-awareness, structured-output, source-citation | Yes |
| Test Data Expert | `test-data-expert` | `/gen-testdata` | session | schema-awareness, structured-output | Yes |

### Code Reviewer

Performs code review against your team's standards. Produces severity-tiered findings
(CRITICAL / WARN / INFO) with source citations. Uses `critical-thinking: MEDIUM` —
flags clear defects and significant design concerns without opining on style preferences.

**Typical invocation:**
```
/review-code
```
or on a specific file:
```
/review-code src/services/payment-service.ts
```

**Output format:** Structured findings list. Each finding includes: severity, location
(file + line), description, citation, and recommendation.

---

### Security Reviewer

Security-focused code review. Uses `critical-thinking: HIGH` — treats absence of
evidence as a gap, surfaces worst-case scenarios first, never softens findings to
avoid friction. Covers: authentication, authorization, input validation, cryptographic
usage, secret handling, injection risks, and dependency vulnerabilities.

**Typical invocation:**
```
/review-security
```
or targeted:
```
/review-security src/auth/
```

**Output format:** Structured findings list. Security findings include an additional
`cvss_estimate` field (LOW / MEDIUM / HIGH / CRITICAL) and an `exploitability` note.

---

### Test Generator

Generates unit and integration tests from function signatures, class definitions, or
module exports. Produces tests in the testing framework already used in the repo
(detected from `package.json` devDependencies and existing test files). Covers: happy
path, boundary conditions, error cases, and null/undefined handling.

**Typical invocation:**
```
/gen-tests src/services/user-service.ts
```

**Output format:** Ready-to-run test file(s) following the repo's existing test
conventions. Includes a brief explanation of what each test covers and why.

---

### Test Data Expert

Generates realistic, schema-consistent synthetic test data. Reads the data model from
TypeScript types, Zod schemas, or database schema files and produces data that is
structurally valid, type-correct, and diverse enough to exercise edge cases.

**Typical invocation:**
```
/gen-testdata src/domains/user/user.types.ts
```

**Output format:** TypeScript constant declarations, JSON fixtures, or SQL INSERT
statements (detected from context). Each output includes a comment explaining any
domain assumptions made.

---

## IDE Availability

All V1 personas are available via Claude Code slash commands (the primary interface).
All personas that produce structured output also work in editor integrated mode —
when invoked from within an open file, they automatically scope to the visible file
context.

For GitHub Copilot and Cursor compatibility, see the note about agentskills.io in
[`README.md`](README.md). Personas compiled from AgentBoot follow the SKILL.md standard
and work in any agentskills.io-compatible tool.

---

## V1 Core Traits

| Trait | ID | Configurable | Used By |
|---|---|---|---|
| Critical Thinking | `critical-thinking` | Yes (HIGH/MEDIUM/LOW) | code-reviewer, security-reviewer |
| Structured Output | `structured-output` | No | all V1 personas |
| Source Citation | `source-citation` | No | code-reviewer, security-reviewer, test-generator |
| Confidence Signaling | `confidence-signaling` | No | code-reviewer, security-reviewer |
| Audit Trail | `audit-trail` | No | security-reviewer |
| Schema Awareness | `schema-awareness` | No | test-generator, test-data-expert |

---

## Personas in the growth pipeline

The following personas are under consideration for V2. None are committed or scheduled.
If you want to work on one, open an issue using the
[Persona Request](.github/ISSUE_TEMPLATE/persona-request.md) template.

- **Architecture Reviewer** — Reviews structural decisions, dependency direction, and
  bounded context violations. Candidate scope: PR / ADR file.
- **Documentation Reviewer** — Checks that public APIs, complex functions, and
  architectural decisions are documented adequately. Candidate scope: PR / file.
- **Dependency Auditor** — Audits `package.json` / `pom.xml` / `go.mod` for outdated,
  vulnerable, or license-incompatible dependencies. Candidate scope: session.
- **Incident Analyst** — Given a log dump or error trace, identifies root cause, blast
  radius, and remediation path. Candidate scope: session.
- **Database Reviewer** — Reviews schema migrations for safety, reversibility, and
  performance risks. Candidate scope: PR / migration file.

---

## How to contribute a persona

1. Read [`docs/concepts.md`](docs/concepts.md) to understand what a persona is and how
   it composes traits.
2. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) for the quality bar and the issue-first policy.
3. Open a [Persona Request](.github/ISSUE_TEMPLATE/persona-request.md) issue.
4. Wait for maintainer acknowledgment before writing code.

The quality bar for a merged persona:
- Complete SKILL.md frontmatter (id, name, version, traits, scope, output_format)
- Clear system prompt that reads like a job description
- Explicit output format specification
- What-not-to-do section
- At least one worked example

---

*Generated by AgentBoot build. Do not edit manually.*
*Last updated: 2026-03-17*
