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

> **A note on `applyTo`.** `"**"` above is always-on, which every platform can honour. A
> *narrowing* glob (`"src/api/**"`) is only expressible on Copilot (natively) and Cursor,
> Windsurf and JetBrains (translated). Claude Code, Skill, plugin, AGENTS.md, Codex and
> Gemini have no scoping mechanism, so the rule reaches them always-on — the build fails
> unless the artifact carries `scope-unsupported: acknowledged`. See
> [the platform capability matrix](/docs/platform-capability-matrix).

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

## Targets that cannot enforce

`guardrail: hard` is a claim that a control is **mechanically enforced**. Not every platform can make
that true — see [the platform capability matrix](platform-capability-matrix.md). Cursor, Windsurf,
JetBrains, `AGENTS.md` and skill output are **instructions only**: nothing binds a hook, so nothing
blocks.

**Building a HARD artifact for one of those targets fails the build.** A directive the target cannot
enforce, silently emitted as ordinary prose, is a compliance hole with a green build and a signed
manifest — the artifact would be byte-indistinguishable from a soft preference while the manifest
attested it arrived intact.

Two ways to resolve it:

1. **Remove the unenforceable target** from `personas.outputFormats`, or
2. **Acknowledge advisory delivery** on the artifact, when reaching those agents with guidance is
   genuinely the intent:

```markdown
---
description: Never log PHI to any sink
applyTo: "**/*"
guardrail: hard
advisory-on-unenforceable: acknowledged
---
```

The artifact still ships; the build warns instead of failing, and names the advisory targets. The
acknowledgement is per-artifact on purpose — a global switch would let one decision quietly cover
future artifacts nobody reconsidered.

`agentboot doctor` reports the same thing from the other direction: it now counts artifacts declaring
`guardrail: hard`, not just `managed` config keys, and warns per target that cannot enforce them.

## Artifact identity

Every governance artifact carries a permanent identifier in its frontmatter:

```yaml
id: 01KZH2S4N8H1AEPFCWPJRBHTA5   # opaque, permanent — survives rename/split/merge
slug: critical-thinking           # human-readable, free to change
hash: sha256:9a520ca580354ef6     # integrity for THIS revision
```

Three fields with three jobs, deliberately separate. **The `id` is the identity** — it never changes
once minted, which is what lets an artifact's history survive renames and scope moves. The `slug` is
for humans and may be edited freely. The `hash` describes the current revision and moves on every
edit, so it is integrity, not identity. Conflating the two is the usual mistake: a content hash
identifies a *version*, and lineage dies at the first edit.

`agentboot add` mints an id at creation. `agentboot identity` backfills existing artifacts and
refreshes hashes — it is **idempotent and never regenerates an existing id.** Use `--dry-run` first.

Identity is stamped **before v1.0.0** on purpose: it cannot be applied retroactively. An id minted
later can only date from later, and after the GA tag adding the field is a breaking change for every
consumer plus a re-sync of every spoke.

**Reserved, not yet active:** `tier:` (`constitutional` / `statutory` / `ephemeral`) declares an
artifact's intended change-rate. The slot exists so the schema is stable at GA; nothing consumes it
yet, and untagged artifacts are deliberately **not** assigned a default.

## Waiving a capability gap

When a configured capability can be honoured by none of your configured output formats, the build
fails. The sanctioned waiver is a policy exception in `agentboot-exceptions.json` with the key
`capability:<id>`:

```json
[{ "id": "EX-2026-014", "policy": "capability:compliance.inputScan.scannerCommand",
   "reason": "cursor-only pilot; Claude Code lands next quarter",
   "approver": "…", "owner": "…", "created": "2026-08-08", "expires": "2026-11-08" }]
```

It is deliberately not a config boolean. A boolean can be pasted once and never revisited; an owned,
expiring record cannot — the day after `expires`, the build fails again. The waiver silences the
error, never the fact: an accepted gap prints on every build, naming its owner and expiry, and appears
in generated evidence packs.
