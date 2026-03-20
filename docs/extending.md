# Extending AgentBoot

AgentBoot ships generic. Your organization almost certainly has requirements that are
specific to your industry, your compliance regime, or your internal standards. This
document explains how to build a domain layer on top of AgentBoot core — without
modifying core, without forking the repository, and without coupling your proprietary
requirements to the public codebase.

---

## When to extend vs. when to contribute back

The rule is simple: if it is specific to your organization, extend. If it would be
useful to any team in your vertical, contribute back.

**Extend when:**
- The requirement is specific to your org's interpretation of a compliance standard,
  not the standard itself.
- The requirement references your internal systems, internal terminology, or your
  private codebase conventions.
- The persona or trait would only make sense to people who know your company.

**Contribute back when:**
- The trait is generic enough to apply to any team in your industry.
- The domain template would give other teams in your vertical a useful starting point.
- The bug fix or improvement applies to the core behavior that everyone uses.

When in doubt, start with an extension in your org personas repo. If it proves useful
enough that you find yourself wishing other teams could use it, open a contribution
proposal issue.

---

## The domain template structure

AgentBoot provides a domain template under `domains/compliance-template/` that shows
the structure of a domain layer. A domain layer is a directory that lives alongside
your `agentboot.config.json` (in your org personas repo) and adds to core without
replacing it.

A domain layer has this structure:

```
domains/
  my-domain/
    README.md                     ← explains the domain, how to configure it
    agentboot.domain.json         ← domain manifest: name, version, traits, personas
    traits/
      my-domain-trait.md          ← domain-specific trait definitions
    personas/
      my-domain-reviewer/
        SKILL.md                  ← domain-specific persona
    instructions/
      always-on.md                ← domain-level always-on instructions
      path-scoped/
        *.domain-file.md          ← path-scoped instructions for sensitive file types
```

The domain manifest (`agentboot.domain.json`) registers the domain with the build system:

```json
{
  "name": "my-domain",
  "version": "1.0.0",
  "description": "Domain layer for [your domain here]",
  "traits": ["my-domain-trait"],
  "personas": ["my-domain-reviewer"],
  "requires_core_version": ">=1.0.0"
}
```

To activate the domain, add it to your `agentboot.config.json`:

```jsonc
{
  "extend": {
    "domains": ["./domains/my-domain"]
  }
}
```

---

## How to add a domain-specific trait

A domain-specific trait follows the exact same format as a core trait (see
`core/traits/critical-thinking.md` for the reference implementation). The difference
is that it lives in your domain layer and may reference domain-specific concepts.

**Example: adding an audit-logging awareness trait**

Suppose your domain requires that all database mutations emit audit log entries. You want
a trait that makes any reviewing persona aware of this requirement and flags violations.

Create `domains/my-domain/traits/audit-logging-awareness.md`:

```markdown
# Trait: Audit Logging Awareness

**ID:** `audit-logging-awareness`
**Category:** Domain compliance
**Configurable:** No

---

## Overview

This trait makes a persona aware that all database mutations in [your domain] must emit
structured audit log entries. Any reviewing persona that composes this trait will flag
missing or malformed audit log calls.

---

## Behavioral Directives

When reviewing code that performs database mutations:

- Verify that every INSERT, UPDATE, and DELETE is accompanied by an audit log call.
- Check that the audit log call captures: the actor (user/service identity), the
  resource affected (table + primary key), the action type, and the timestamp.
- Flag any mutation that relies on a trigger or middleware for audit logging without
  verifying that the trigger/middleware is in place for the affected table.
- Flag audit log calls that do not capture sufficient context to reconstruct the
  state change.

---

## Anti-Patterns to Avoid

- Do not flag read operations (SELECT). Audit requirements apply to mutations only.
- Do not assume audit logging is handled elsewhere without evidence.
- Do not accept "the framework handles this automatically" without verifying that the
  framework is configured to do so for this specific table.

---

## Interaction with Other Traits

- **`critical-thinking: HIGH`** — at HIGH weight, flag even cases where audit logging
  is present but appears incomplete or inconsistent with other tables.
- **`source-citation`** — every audit finding must cite the specific line where the
  mutation occurs and the specific line (or lack thereof) where audit logging is absent.
```

Then declare the trait in your domain manifest and compose it into your domain personas.

---

## How to add a domain-specific persona

A domain persona follows the same SKILL.md format as a core persona. The difference is
that its system prompt can reference your domain's specific requirements, terminology,
and standards — because it lives in your domain layer, not in core.

**Example: adding a compliance reviewer**

Create `domains/my-domain/personas/compliance-reviewer/SKILL.md`:

```markdown
---
id: compliance-review
name: Compliance Reviewer
version: 1.0.0
traits:
  critical-thinking: HIGH
  structured-output: true
  source-citation: true
  audit-logging-awareness: true
scope: pr
output_format: structured
---

You are the compliance reviewer for [your domain]. Your mandate is to verify that
code changes conform to [your domain]'s compliance requirements before they merge.

[Your domain-specific system prompt here. Describe the compliance context, the
specific requirements the persona should enforce, and the scope of review.]

## Output Schema

...

## What Not To Do

...
```

---

## How to add path-scoped instructions for sensitive file types

Path-scoped instructions activate only when the user's working context involves matching
file patterns. They are one of the most powerful features in AgentBoot because they let
you add domain-specific guidance exactly where it is needed without polluting every
interaction.

Create a file in `domains/my-domain/instructions/path-scoped/`. The filename determines
the glob pattern that activates the instruction:

```
path-scoped/
  *.migration.sql.md    ← activates when the user is working on migration files
  config/secrets*.md   ← activates when working in the secrets config directory
  api/*/handlers/*.md  ← activates when working on API handler files
```

The content of the file is an instruction fragment that is prepended to the system prompt
when the path pattern matches. Keep it focused and specific — path-scoped instructions
should add exactly the context that matters for that file type, not general guidance.

Example `domains/my-domain/instructions/path-scoped/*.migration.sql.md`:

```markdown
## Database Migration Context

You are working on a database migration file for [your domain].

Migrations in this domain must:
- [List your domain-specific migration requirements here]

Before suggesting any migration change, verify:
- [Your pre-migration verification checklist]
```

---

## How org-level customization works

The `extend` field in `agentboot.config.json` is the integration point for all
customization. It can reference:

- Local directories (relative to `agentboot.config.json`): `"./personas"`, `"./domains/my-domain"`
- Domain manifests: an array of domain paths, each resolved and merged in order

```jsonc
{
  "org": "my-org",
  "personas": {
    "enabled": ["code-reviewer", "security-reviewer", "test-generator"],
    "extend": "./personas"
  },
  "extend": {
    "domains": [
      "./domains/my-domain",
      "./domains/my-second-domain"
    ],
    "instructions": "./instructions/org-always-on.md"
  }
}
```

**Precedence rules for `extend`:**
1. Core traits and personas form the base.
2. Domain layers are applied in the order listed. Later domains can add to but not
   remove core traits or personas.
3. The `personas.extend` directory adds org-specific personas on top of domain layers.
4. Team-level configuration (scoped via group/team in `repos.json`) layers on top of
   all of the above for repos in that team.

Nothing in a domain layer can disable a core trait or persona that a higher scope has
marked required. Extensions add; they do not subtract. This is the guarantee that
org-level governance always propagates downward.

---

## Per-persona extensions

Domain layers can extend individual personas without modifying the base definition. This
is the "extend without modify" pattern — critical for multi-product organizations where
each product has specific requirements that should layer on top of the generic persona.

Create an extension file at `domains/my-domain/extensions/{persona-name}.md`:

```markdown
## Additional Review Rules (My Domain)

When reviewing code in this domain, also check for:

- All API endpoints must validate the `X-Tenant-ID` header before processing
- Database connections must use the read replica for GET endpoints
- Event payloads must include `correlationId` for distributed tracing
```

The persona reads its extension file during the Setup phase (before beginning review).
Extension rules **add to** the base persona's rules — they do not replace them. If an
extension rule conflicts with a base rule, the extension is ignored and the conflict
is logged.

This pattern was validated in a production implementation, where product-level
extensions added HIPAA-specific checks to the generic code reviewer, security
reviewer, and test data expert without changing any base agent definitions.

---

## How to add gotchas rules

Gotchas rules are path-scoped instructions that encode battle-tested operational
knowledge. They are the single highest-value extension you can add — developers
immediately see value when the agent warns them about a pitfall they would have hit.

Create gotchas files in `domains/my-domain/instructions/path-scoped/`:

```markdown
---
paths:
  - "**/*.lambda.ts"
  - "functions/**"
description: "Lambda deployment gotchas"
---

# Lambda Gotchas

- **Cold start penalty scales with bundle size.** Keep handler files under 5MB.
  Tree-shake aggressively. Do not import the entire AWS SDK — import only the
  client you need (`@aws-sdk/client-s3`, not `aws-sdk`).
- **Environment variables are NOT encrypted at rest by default.** Use SSM
  Parameter Store or Secrets Manager for anything sensitive. Never put API keys
  in Lambda env vars directly.
- **Timeout default is 3 seconds.** If your handler does any I/O, set timeout
  explicitly. A timed-out Lambda still gets billed for the full duration.
- **Do not use `console.log` with objects in production.** Use structured logging
  (`JSON.stringify` with defined fields) or the Lambda Powertools logger.
```

Sources for gotchas:
- Post-incident reviews ("what did we learn?")
- Onboarding notes ("what I wish I knew")
- Code review comments that keep repeating the same feedback
- Production debugging sessions where the root cause was non-obvious

The best gotchas rules are specific, actionable, and explain *why* — not just *what*.
"Don't do X" is less useful than "Don't do X because Y will happen, and here's how
to verify you haven't done it."

---

## How to add compliance hooks

For organizations with compliance requirements (HIPAA, SOC 2, PCI DSS, GDPR),
AgentBoot supports a defense-in-depth hook model. See
[`docs/concepts.md`](concepts.md#compliance-hooks) for the three-layer model.

To add compliance hooks to your domain:

1. Create the hook script in `domains/my-domain/hooks/`:

```bash
#!/bin/bash
# hooks/sensitive-data-scan.sh
# Exit 2 = block request, Exit 0 = allow

INPUT="$1"

# Patterns to detect
if echo "$INPUT" | grep -qE '\b\d{3}-\d{2}-\d{4}\b'; then
  echo '{"error": "SSN pattern detected. Remove before continuing."}' >&2
  exit 2
fi
if echo "$INPUT" | grep -qE '\b(sk|pk)_(live|test)_[A-Za-z0-9]{24,}\b'; then
  echo '{"error": "API key detected. Remove before continuing."}' >&2
  exit 2
fi
exit 0
```

2. Create a hook configuration fragment in `domains/my-domain/hooks/settings.json`
   that the build system merges into each target repo's `.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/sensitive-data-scan.sh",
            "timeout": 5000
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/sensitive-data-output-scan.sh"
          }
        ]
      }
    ]
  }
}
```

Claude Code supports a comprehensive set of hook events. The most relevant for compliance:
- `UserPromptSubmit` — scan input before the model sees it (Layer 1, deterministic)
- `PreToolUse` — intercept specific tool calls (e.g., block `Bash(rm -rf *)`)
- `PostToolUse` — scan tool output for sensitive data
- `Stop` — scan model output (Layer 3, advisory — fires after render)
- `SessionStart` — audit logging of session initiation

3. Create the corresponding always-on instruction in
   `domains/my-domain/instructions/always-on.md` (the Layer 2 advisory control):

```markdown
## Sensitive Data Policy

You must never process, store, or output real customer data, personally identifiable
information, production credentials, or internal API keys. If user input appears to
contain any of these, stop immediately, explain what you detected, and ask the user
to remove it before continuing.
```

4. For HARD guardrails (non-overridable), generate managed settings artifacts in
   `domains/my-domain/managed/` for MDM deployment:

```
managed/
  managed-settings.json    → /Library/Application Support/ClaudeCode/ (macOS)
  managed-mcp.json         → /Library/Application Support/ClaudeCode/ (macOS)
  CLAUDE.md                → /Library/Application Support/ClaudeCode/ (macOS)
```

Managed settings cannot be overridden by any project or user configuration. This is
the native Claude Code mechanism for HARD guardrails.

5. Document the honest limitations — which platforms enforce deterministically vs.
   advisory-only. This transparency builds trust with compliance teams.

**Platform support matrix:**

| Layer | Claude Code | Copilot CLI | IDE (VS Code/IntelliJ) |
|-------|-------------|-------------|------------------------|
| Input hook (deterministic) | `UserPromptSubmit` | Pre-prompt hook | Not available |
| Instruction refusal (advisory) | CLAUDE.md | copilot-instructions.md | copilot-instructions.md |
| Output hook (advisory) | `Stop` | Not available | Not available |
| Managed settings (HARD) | MDM paths | Not available | Not available |

---

*See also:*
- [`docs/concepts.md`](concepts.md) — the scope hierarchy and trait system explained
- [`docs/configuration.md`](configuration.md) — complete `agentboot.config.json` reference
- [`domains/compliance-template/README.md`](../domains/compliance-template/README.md) — worked example domain template
