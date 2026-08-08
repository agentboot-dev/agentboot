---
id: templates
title: "Harness templates: install a ready-to-tune setup with one command"
description: Install a pre-packaged harness bundle into your hub with `agentboot add template`, then tune its rigor via trait weights.
---

# Harness templates: install a ready-to-tune setup with one command

A **template** is a pre-packaged bundle of hub files — a persona plus its config,
already wired into your hub's layout — that you install with one command and then
tune like anything else you authored yourself.

```bash
# from your hub root
agentboot add template sdlc-orchestrator
```

Templates are all-or-nothing: AgentBoot checks every file in the bundle for
conflicts **before** writing anything. If any target file already exists, the
install refuses and lists the conflicts — it never overwrites your work, and it
never leaves a half-applied template behind.

After install, the template prints its activation step. For the shipped template:

```
✓ Added template: sdlc-orchestrator

  core/personas/sdlc-orchestrator/SKILL.md
  core/personas/sdlc-orchestrator/persona.config.json

  Add "sdlc-orchestrator" to personas.enabled in agentboot.config.json,
  then run: agentboot validate && agentboot build
```

v1.0 ships one template: **sdlc-orchestrator**. Running `agentboot add template`
with an unknown name lists what's available.

## The sdlc-orchestrator template

A **phase-gated software delivery persona** (invoked as `/sdlc`) that drives a
change from spec to merge — and is written to hold each phase until its exit criteria
are met:

1. **Spec (PRD)** — problem statement, scope, acceptance criteria as a pass/fail
   checklist. *Exit: every criterion is testable.*
2. **Architecture** — components, interfaces, failure modes, rollback path;
   consequential choices recorded as lightweight ADRs. *Exit: the approach is
   written down and every acceptance criterion maps to a place in the design.*
3. **Implementation (parallel worktrees)** — work decomposed into independent
   workstreams in separate git worktrees so they progress without colliding.
   *Exit: each workstream builds and its tests pass in isolation.*
4. **QA gates** — formatter/linter, type check, tests, security/dependency scan,
   in order, each treated as a stop-on-failure gate. *Exit: every gate green, new code
   covered.*
5. **Review & merge** — a diff scoped to one concern, description tied to the
   spec, gate results attached, reviewed against a checklist. *Exit: acceptance
   criteria demonstrably met.*

## Tuning the rigor

The template's discipline level isn't hardcoded — it's set by trait weights in
`persona.config.json`:

```jsonc
{
  "name": "SDLC Orchestrator",
  "invocation": "/sdlc",
  "traits": {
    "critical-thinking": "HIGH",    // rigor of design/diff scrutiny — raise for high-risk changes
    "structured-output": "HIGH",    // strictness of phase reporting
    "audit-trail": "MEDIUM",        // decision/gate provenance — raise where change-control matters
    "source-citation": "MEDIUM",    // cite the acceptance criterion behind a call
    "confidence-signaling": "MEDIUM"
  }
}
```

Weights run `OFF | LOW | MEDIUM | HIGH | MAX`. Traits with
[weight-tier sections](./concepts.md) inject only the guidance nearest the chosen
weight, so a `LOW` persona doesn't drag `MAX`-tier instructions into its context.
Change a weight, run `agentboot build`, and every platform output rebuilds.

Two teams can run the same template at different intensities: `MAX`
critical-thinking and audit-trail for a payments service, `LOW` for a prototype
repo — same workflow, different rigor, one source file.

## A template is starting material

Everything a template installs is plain markdown and JSONC in **your** hub. Edit
the phases, delete a gate, rename the invocation — after `add template` it's your
file, versioned and reviewed like everything else. There's no link back to the
template and no update mechanism to fight; a template is a scaffold, not a
subscription.

## When not to use this

If your team already has a working delivery workflow written down somewhere, don't
replace it with a template — [import it](./import.md) and make it the persona.
Templates are for teams starting from a blank page who'd rather tune a disciplined
default than write one from scratch.
