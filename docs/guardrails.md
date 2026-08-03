---
id: guardrails
title: Guardrails — rules a team cannot silently weaken
description: How to author a HARD guardrail with guardrail:hard frontmatter, what lower scopes may and may not do to it, and where enforcement is real versus advisory.
---

# Guardrails

Most instructions are **preferences**: an org states a default and a team adapts it. Some
are not. A rule like *"never read files matching `.env`"* is not a starting point for
negotiation — if a team can quietly turn it off, it was never a control.

AgentBoot calls the second kind a **HARD guardrail**. This page is how to author one.

---

## Authoring a HARD guardrail

Add `guardrail: hard` to the frontmatter of an instruction or trait:

```markdown
---
description: "Secrets are never read directly by an agent"
applyTo: "**"
guardrail: hard
---

# Secret read deny

- Never read `.env`, `*.pem`, or anything under `secrets/`. Ask for the value to be
  provided through the configured secret store instead.
```

Save it as `core/instructions/<name>.instructions.md` (org scope). Or scaffold it:

```bash
agentboot add instruction secret-read-deny
```

The generated file carries the frontmatter schema and a commented-out `guardrail: hard`
line to uncomment.

**Without `guardrail: hard`, an instruction is a soft preference** — a lower scope may
override it, and that override is reported as informational rather than as an error.

## What lower scopes may and may not do

Scopes compose by **merge**, not replacement: a team layers on top of its group, which
layers on top of the org. What changes for a HARD artifact is what a lower scope is
permitted to do to it.

| Lower scope tries to… | Soft artifact | `guardrail: hard` artifact |
|---|---|---|
| Add to it | allowed | allowed |
| Shadow it with a same-named file | allowed — informational | **error in `validate --strict`** |
| Downgrade it to `guardrail: soft` | n/a | **error in `validate --strict`** |
| Set the trait weight to `OFF` / `0` | allowed | **error in `validate --strict`** |

Both override paths are checked, so a guardrail cannot be neutralised either by
re-declaring the artifact at a lower scope or by zeroing its weight in a persona config.

Run the check explicitly:

```bash
agentboot validate --strict
```

> **`validate` does not gate `build`.** They are separable commands by design — `build`
> can succeed on a config `validate --strict` rejects. **Run both in CI**, with `validate
> --strict` first, or a guardrail violation will compile and ship.

## Config-level guardrails

Beyond content, `managed.guardrails` in `agentboot.config.json` controls agent behaviour
directly:

```jsonc
{
  "managed": {
    "guardrails": {
      "denyTools": ["WebFetch", "Bash"],
      "disableBypassPermissions": true,
      "requireAuditLog": true
    }
  }
}
```

**`denyTools` takes tool names only** — matched against `[a-zA-Z0-9._*?-]+`, so glob
characters are allowed but path expressions are not. A path-scoped deny is a permissions
concern and belongs in the platform pass-through instead:

```jsonc
{
  "claude": {
    "permissions": {
      "deny": ["Read(**/.env)", "Read(**/secrets/**)"]
    }
  }
}
```

Putting `Read(**/.env)` in `denyTools` is rejected at build time with a pointer to this
distinction.

## Where enforcement is real, and where it is advice

This is the part to read before promising anything to a security reviewer.

| Surface | What a guardrail does |
|---|---|
| Claude Code, Codex CLI, GitHub Copilot CLI | Compiled to **blocking hooks** — the action is denied (exit code 2) |
| `AGENTS.md` | **Advisory.** No hook mechanism exists in the standard |
| Cursor, Gemini, Windsurf, JetBrains | **Advisory.** Community tier; content is delivered, nothing blocks |

So a HARD guardrail is a hard *policy* everywhere and a hard *control* only on the three
officially supported CLI surfaces. Everywhere else it is instruction text the agent is
asked to follow.

Verify rather than assume — the conformance harness executes the compiled hooks with
crafted inputs and reports what actually happened:

```bash
agentboot conformance
```

A control it cannot probe is reported `untested`, never as passing.

## Limits worth knowing

- **Hooks bind the tool, not the machine.** Someone who uninstalls the agent tooling is
  outside their reach. Branch protection and CI are what cover that.
- **Scope-level instruction *content* does not compile yet.** Persona definitions and
  trait weights do. Authoring guardrail content at team scope produces a loud build
  warning rather than silent no-op output — put org-wide guardrails in
  `core/instructions/`.
- **Drift is detected, not prevented.** If a delivered hook is edited or deleted in a
  spoke, `drift-check` and `verify-manifest` will tell you. Nothing stops the edit.

## See also

- [Configuration](./configuration.md) — the full `managed` and `claude` blocks
- [Platform capability matrix](./platform-capability-matrix.md) — what each platform enforces
- [Assurance claims](./assurance-claims.md) — every claim on this page and the probe backing it
