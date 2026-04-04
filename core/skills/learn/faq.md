# AgentBoot FAQ

## What is the difference between a trait and a persona?

A **trait** is a reusable behavioral building block — a single capability like
"cite your sources" or "use structured output with severity levels." Traits live
in `core/traits/` as standalone Markdown files.

A **persona** is a complete AI assistant role that composes multiple traits together
with role-specific behavioral instructions. Personas live in `core/personas/{name}/`
and consist of a `SKILL.md` (the definition) and a `persona.config.json` (metadata
and trait list).

Think of traits as ingredients and personas as recipes. The build pipeline combines
them at compile time so each persona ships as a single self-contained file.

---

## How do traits get composed into personas?

At build time, the compile step:

1. Reads the persona's `persona.config.json` to find which traits it references.
2. Loads each trait's Markdown content from `core/traits/`.
3. Injects the trait content between `<!-- traits:start -->` and `<!-- traits:end -->`
   markers in the persona's `SKILL.md`.
4. Writes the composed result to `dist/` in each target platform's format.

This is build-time composition, not runtime. Once compiled, every persona is
self-contained — no external references, no dynamic loading.

---

## What is the difference between build and sync?

**Build** (`npx agentboot build`) compiles persona source files into platform-native
output under `dist/`. It reads from `core/` and writes to `dist/`. No external repos
are touched.

**Sync** (`npx agentboot sync`) distributes the compiled output from `dist/` to
target repos listed in `repos.json`. It reads from `dist/` and writes to external
repos. Build must happen before sync.

The full pipeline is: `validate` (check correctness) then `build` (compile) then `sync`
(distribute). The `dev-build` command runs all three with dev-sync for local testing.

---

## What is the scope hierarchy?

AgentBoot uses four levels of scope: **Org > Group > Team > Repo**.

- **Org (core/):** Applies to every repo in the organization.
- **Group (groups/{group}/):** Applies to all teams within that group.
- **Team (teams/{group}/{team}/):** Applies only to that team's repos.
- **Repo:** Per-repo enrichments for specific repositories.

For optional behaviors, the more specific scope wins — a team-level rule overrides a
group-level rule, which overrides an org-level rule. For mandatory behaviors
(compliance guardrails), inheritance is top-down — org-level rules cannot be
overridden by more specific scopes.

Groups and teams are configured in `agentboot.config.json`:
```json
{
  "groups": {
    "platform": { "teams": ["api", "infra", "data"] },
    "product":  { "teams": ["web", "mobile", "growth"] }
  }
}
```

---

## How do I test my personas?

AgentBoot has a 6-layer test pyramid:

1. **Unit/Schema tests** (free, every commit): Config validation, frontmatter
   checks, trait composition, lint rules. Run with `npx agentboot test`.

2. **Integration tests** (free, every commit): Full build pipeline, plugin export,
   sync, uninstall. Run with `npx vitest run`.

3. **Behavioral tests** (~$5/PR): Use `claude -p` with known-buggy code and assert
   on findings. Run with `npx agentboot test --behavioral`.

4. **Snapshot/Regression tests** (~$5, on persona changes): Compare output across
   versions. Run with `npx agentboot test --snapshot`.

5. **LLM-as-Judge** (~$20, major changes): Opus evaluates persona quality on 5
   dimensions. Reserved for significant changes.

6. **Human review** (monthly): Guided review of curated samples. 15 minutes per
   persona.

For day-to-day development, layers 1 and 2 run on every commit. Layer 3 runs on
PRs. Layers 4-6 are for significant changes or periodic review.

---

## What platforms does AgentBoot support?

**Currently supported:**
- **Claude Code** — native `.claude/` format with skills, agents, rules, traits,
  settings, and MCP config
- **GitHub Copilot** — `copilot-instructions.md` fragments in `.github/`
- **Cross-platform SKILL.md** — agentskills.io format, usable by any tool that
  reads Markdown skill definitions

**Planned:**
- **Cursor** — `.cursor/rules/` glob-scoped rules (Phase 4)
- **AGENTS.md** — universal cross-tool standard (Phase 4)
- **Gemini** — Google AI Studio format (Phase 7)
- **JetBrains** — JetBrains AI Assistant format (Phase 7)

Output formats are configured in `agentboot.config.json` under `personas.outputFormats`.

---

## How do gotchas and rules work?

Gotchas are path-scoped knowledge rules in `core/gotchas/`. Each gotcha is a Markdown
file with `paths:` frontmatter that specifies which file patterns activate the rule:

```yaml
---
paths:
  - "src/auth/**"
  - "src/middleware/**"
---
# Auth Module Gotcha

Never use deprecated session library X. Use library Y instead.
See incident INC-1234 for context.
```

At build time, gotchas compile into `.claude/rules/` files. When a developer opens a
file matching the path pattern, the rule activates automatically — no manual
invocation needed.

Gotchas encode battle-tested operational knowledge: "this API has a quirk," "never
do X in this directory because of Y incident," "files here must pass compliance
review." They are technology-specific rather than org-specific, making them
shareable across organizations via the marketplace.

---

## How do I update personas across all my repos?

1. **Edit the source files** in the hub repo (`core/personas/`, `core/traits/`,
   `core/gotchas/`, `core/instructions/`).

2. **Build:** Run `npx agentboot build` to compile the changes into `dist/`.

3. **Preview:** Run `npx agentboot sync --dry-run` to see what will change in
   each target repo.

4. **Apply:** Run `npx agentboot sync` to distribute the compiled output to all
   repos listed in `repos.json`.

This is the hub-and-spoke distribution model. The hub (this repo) is the single
source of truth. Spoke repos receive compiled output but never hold source
definitions. Updates flow one-way: hub to spokes.

---

## How do I add a new persona?

1. Create a directory: `core/personas/{name}/`

2. Create `SKILL.md` with frontmatter and behavioral instructions:
   ```markdown
   ---
   name: my-persona
   description: What this persona does
   ---

   # My Persona

   ## Identity
   You are...

   ## Behavioral Instructions
   ...

   <!-- traits:start -->
   <!-- traits:end -->
   ```

3. Create `persona.config.json`:
   ```json
   {
     "name": "My Persona",
     "description": "One-line description",
     "invocation": "/my-command",
     "traits": ["critical-thinking", "structured-output"]
   }
   ```

4. Add the directory name to `personas.enabled` in `agentboot.config.json`.

5. Run `npx agentboot build` to compile.

---

## What is the hub-and-spoke model?

AgentBoot uses a **hub-and-spoke distribution model**:

- The **hub** is the central personas repo (this repo) containing the source of
  truth for all persona definitions, traits, gotchas, and instructions.

- **Spokes** are the target repos listed in `repos.json` that receive compiled
  persona output.

Flow is one-way: hub compiles and publishes, spokes receive. Spokes never hold
source definitions. This ensures consistency across the organization — every repo
gets the same persona behavior from the same source.

---

## What is the difference between instructions and traits?

**Instructions** (`core/instructions/`) are always-on behavioral guardrails that
apply to every session, regardless of which persona is invoked. They define the
baseline posture for all AI interactions (e.g., code quality principles, security
rules).

**Traits** (`core/traits/`) are opt-in behavioral modules that personas selectively
compose. A persona chooses which traits it needs via its `persona.config.json`. Not
every persona uses every trait.

Think of instructions as "always active rules" and traits as "persona-selected
capabilities."
