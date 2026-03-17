# Compliance Domain Template

This directory is a starting point for building a compliance domain layer on top of
AgentBoot core. Copy and rename it for your specific compliance context
(e.g., `domains/healthcare/`, `domains/fintech/`, `domains/federal/`), then fill in
your organization's actual requirements.

This README explains the template structure, how to adapt it, and how to test and
deploy the domain layer alongside core.

---

## What this template gives you

- A trait file (`traits/compliance-aware.md`) showing the structure of a compliance
  trait with placeholder content you fill in
- A domain manifest stub (`agentboot.domain.json`) you edit to match your domain
- A directory layout that the AgentBoot build system knows how to resolve

What this template does NOT give you: real compliance rules. The template contains no
actual regulatory requirements, no jurisdiction-specific obligations, and no proprietary
compliance content. Those are yours to add.

---

## Template structure

```
domains/compliance-template/
  README.md                        ← this file
  agentboot.domain.json            ← domain manifest (edit this)
  traits/
    compliance-aware.md            ← example compliance trait (fill in)
  personas/
    compliance-reviewer/
      SKILL.md                     ← compliance reviewer persona (fill in)
  instructions/
    always-on.md                   ← always-on compliance context (fill in)
    path-scoped/
      *.config.md                  ← activates on config file changes (example)
```

---

## Step 1: Copy and rename

```bash
cp -r domains/compliance-template domains/your-domain-name
```

Replace `your-domain-name` with a short, lowercase identifier for your compliance
domain. Examples: `healthcare`, `pci`, `sox`, `federal`, `gdpr`.

---

## Step 2: Edit the domain manifest

Open `agentboot.domain.json` and fill in:

```json
{
  "name": "your-domain-name",
  "version": "1.0.0",
  "description": "Compliance domain layer for [your context]",
  "traits": ["compliance-aware"],
  "personas": ["compliance-reviewer"],
  "requires_core_version": ">=1.0.0"
}
```

The `name` field must match the directory name. The `traits` and `personas` arrays
must list all traits and personas defined in this domain that should be registered
with the build system.

---

## Step 3: Fill in the compliance trait

Open `traits/compliance-aware.md`. The file contains placeholder sections marked with
`[your content here]` comments. Replace each placeholder with your actual compliance
requirements.

Follow the design principles in [`CONTRIBUTING.md`](../../CONTRIBUTING.md):
- Keep the trait generic within your domain — no references to specific client configs,
  internal system names, or proprietary tooling.
- Document the behavioral directives at each weight level (HIGH / MEDIUM / LOW), or
  remove the weight system if your compliance requirements are binary.
- Include the "what not to do" section. Without it, the trait will produce noisy output.

---

## Step 4: Fill in the compliance reviewer persona

Open `personas/compliance-reviewer/SKILL.md`. The file contains a complete persona
structure with placeholder sections. Fill in:

1. The system prompt: describe the compliance context, the persona's mandate, and any
   operating assumptions.
2. The output schema: define exactly what a compliance finding looks like (severity,
   citation, recommendation).
3. The what-not-to-do section: what the persona must never flag, what is out of scope,
   and what tempting behaviors to suppress.

---

## Step 5: Fill in always-on instructions

Open `instructions/always-on.md`. This content is prepended to the always-on
instructions in every repo that activates this domain layer. It should be a brief
reminder of the compliance context — not a full rule set (that lives in the trait and
persona). Keep it under 200 words.

---

## Step 6: Add path-scoped instructions (optional)

If your compliance domain has requirements that apply only to specific file types —
database migration files, configuration files, secret management files, API contract
files — add path-scoped instruction files under `instructions/path-scoped/`.

Filename format: the filename becomes the glob pattern. Examples:
- `*.migration.sql.md` — activates when working on SQL migration files
- `config/secrets*.md` — activates when in the secrets config directory
- `iac/**/*.tf.md` — activates when working on Terraform/OpenTofu files

---

## Step 7: Activate the domain in agentboot.config.json

In your org personas repo's `agentboot.config.json`:

```json
{
  "extend": {
    "domains": ["./domains/your-domain-name"]
  }
}
```

---

## Step 8: Test the domain layer

Before deploying to your organization:

1. Run `npm run validate` — verifies frontmatter, trait references, and domain manifest.
2. Run `npm run build` — compiles the domain layer and verifies it merges with core correctly.
3. In a test repo, run `npm run sync` and open Claude Code.
4. Invoke `/compliance-review` on a file that should trigger compliance findings.
5. Invoke `/compliance-review` on a clean file and verify no false positives.
6. Review `PERSONAS.md` to confirm the domain persona appears in the registry.

---

## Deploying alongside core

Domain layers are additive. Activating this domain adds:
- The `compliance-aware` trait to every persona that composes it
- The `compliance-reviewer` persona to the available slash commands
- The always-on instructions to the always-on instruction stack
- Any path-scoped instructions for relevant file types

Core personas (code-reviewer, security-reviewer, test-generator) are not modified.
They continue to operate exactly as they did before the domain layer was activated.

---

## Keeping the domain layer private

Your domain layer will contain your organization's actual compliance requirements.
Do not open-source it. Keep it in your private org personas repo alongside
`agentboot.config.json`. The compliance template in AgentBoot core is a structural
guide only — it contains no content that is specific to any compliance regime.
