# Healthcare Domain Starter Template

> **Disclaimer:** This starter pack provides generic engineering guardrails for
> health-data codebases. It does not establish HIPAA compliance or any regulatory
> posture; compliance is a property of your organization's overall program, not of
> any template.

This directory is a ready-to-use starting point for teams that build software
handling health data. Unlike `domains/compliance-template/` (which ships structure
with placeholders), this pack ships **filled-in generic guardrails**: two traits and
one instruction file that encode engineering hygiene common to health-data
codebases — protected-data handling, synthetic test data, audit events, and
access-control review prompts.

Everything here is intentionally generic. Your organization layers its actual
policies on top in a **private overlay** — see below.

---

## What this pack gives you

- `traits/phi-aware.md` — protected-health-data handling discipline: no production
  patient data in prompts, fixtures, logs, or examples; minimum-necessary context;
  synthetic-test-data expectations; redaction; escalate-when-uncertain.
- `traits/healthcare-engineering.md` — engineering-workflow guardrails: audit
  events on data access paths, authentication/authorization/consent/break-glass
  review prompts, data-retention awareness, secure handling of exports and
  attachments.
- `instructions/healthcare-baseline.md` — the day-to-day rules distilled into a
  session-context instruction file.

## What this pack deliberately does NOT do

- It does **not** establish compliance with any regulation (see the disclaimer
  above — compliance is a program property, not a template property).
- It contains **no legal or regulatory text**, no jurisdiction-specific
  obligations, and no citations to any statute or rule.
- It names **no real company, health system, product, or evaluation program**.
  All examples are invented (`acme-health`, `example.com`, `MRN-000000`).
- It does **not** replace your organization's privacy, security, or legal review
  processes. It adds engineering-session guardrails; it decides nothing.

---

## File map

```
domains/healthcare-template/
  README.md                          ← this file
  traits/
    phi-aware.md                     ← protected-health-data handling trait
    healthcare-engineering.md        ← healthcare engineering-workflow trait
  instructions/
    healthcare-baseline.md           ← day-to-day session rules (applyTo-scoped)
```

---

## How to use it: create a private overlay

This pack is a base layer. Your organization's real requirements — named approval
processes, internal system names, retention schedules, your interpretation of any
regulation — belong in a **private domain directory in your org personas repo
(your private hub)**, never contributed upstream.

1. **Copy this template into your private hub:**

   ```bash
   cp -r domains/healthcare-template <org-personas-repo>/domains/acme-health
   ```

2. **Add a domain manifest** (`agentboot.domain.json`) in the copied directory:

   ```json
   {
     "name": "acme-health",
     "version": "1.0.0",
     "description": "Healthcare domain layer for acme-health",
     "traits": ["phi-aware", "healthcare-engineering"],
     "personas": [],
     "requires_core_version": ">=1.0.0"
   }
   ```

3. **Fill in the org-specific hooks.** Both traits and the instruction file mark
   the decisions only your org can make — the named approval process for any use
   of production data, your audit-event schema, your retention schedule, your
   break-glass procedure. Replace the generic phrasing with your actual process
   names and owners. This content stays in your private hub.

4. **Activate the domain** in your `agentboot.config.json`:

   ```jsonc
   {
     "domains": ["./domains/acme-health"]
   }
   ```

5. **Validate and build** (`npm run validate`, `npm run build`), then sync a test
   repo and confirm the traits and instructions appear.

Domain layers are **additive**: activating this domain adds its traits to the
personas that compose them and its instruction file to the instruction stack. Core
personas and traits are not modified, and nothing here can disable a guardrail a
higher scope marks required (see `docs/extending.md`).

## Keep the overlay private

Your copied-and-filled-in domain will contain your organization's actual policies
and process names. Do not open-source it and do not contribute it back upstream.
Only generic, industry-wide improvements to this starter pack belong in AgentBoot
core — see `docs/extending.md § When to extend vs. when to contribute back`.
