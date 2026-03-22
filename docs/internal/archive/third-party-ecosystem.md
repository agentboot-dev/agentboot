# Third-Party Ecosystem — Partners, Credit & Licensing

AgentBoot exists in a rapidly growing ecosystem of Claude Code frameworks, plugins,
and tools. This doc maps the landscape, identifies partnership opportunities, and
establishes credit/attribution practices.

---

## The Ecosystem Map

```
                        AgentBoot
                    (governance + distribution)
                           │
          ┌────────────────┼────────────────┐
          │                │                │
    Complements       Overlaps         Adjacent
          │                │                │
   ┌──────┴──────┐   ┌────┴────┐    ┌──────┴──────┐
   │ spec-kit    │   │ Super-  │    │ arc-kit     │
   │ (planning)  │   │ Claude  │    │ (arch gov)  │
   │             │   │ (traits │    │             │
   │ Trail of    │   │  agents)│    │ awesome-    │
   │ Bits skills │   │         │    │ claude-code │
   │ (security)  │   └─────────┘    │ (curation)  │
   └─────────────┘                  └─────────────┘
```

---

## Tool Profiles

### 1. SuperClaude Framework

**What:** A configuration framework that enhances Claude Code with specialized
commands, cognitive personas, and development methodologies. 16 core agents,
12 composable traits, 30+ skills, MCP integration.

**Repo:** [SuperClaude-Org/SuperClaude_Framework](https://github.com/SuperClaude-Org/SuperClaude_Framework)
**Author:** NomenAK (community)
**License:** MIT
**Stars:** ~5.7k
**Status:** Active (v4.2.0, Jan 2026). Also has SuperClaude_Plugin and SuperGemini_Framework.

**Relationship to AgentBoot:**

| Dimension | SuperClaude | AgentBoot |
|-----------|------------|-----------|
| Scope | Individual developer | Organization (multi-team, multi-repo) |
| Traits | 12 composable traits | 6 core + extensible domain traits |
| Agents | 16 domain specialists | 4 core + org-specific |
| Distribution | Copy .claude/ to repo | Build pipeline + marketplace + MDM + sync |
| Governance | None (no scope hierarchy) | Org → Group → Team → Repo |
| Compliance | None | Hooks, managed settings, defense-in-depth |
| Format | .claude/ native | agentskills.io + CC-native |

**Overlap:** Trait composition pattern and agent definitions. SuperClaude validates
that the composable-trait approach works at scale. Their `+flag` composition UX
is cleaner than AgentBoot's current design.

**Partnership opportunity:**
- **AgentBoot could ship SuperClaude traits as an optional domain layer.** An org
  could `agentboot add domain superclaude` to get SC's 12 traits + 16 agents as a
  starting point, then customize.
- **SuperClaude users could adopt AgentBoot for governance.** SC solves the "what
  personas to use" problem; AB solves the "how to govern and distribute them at
  scale" problem. They're complementary.
- **Trait format alignment.** If AgentBoot's trait format is compatible with SC's,
  the communities can share traits bidirectionally.

**Credit approach:** Prior art acknowledgment. SuperClaude arrived at composable traits
independently and earlier. ACKNOWLEDGMENTS.md.

---

### 2. ArcKit

**What:** Enterprise Architecture Governance & Vendor Procurement toolkit. 64 AI-assisted
commands for systematic, compliant architecture work following UK Government standards.
Now a CC plugin with marketplace distribution. Supports Claude Code, Gemini CLI,
Codex CLI, OpenCode CLI, Copilot.

**Repo:** [tractorjuice/arc-kit](https://github.com/tractorjuice/arc-kit)
**Author:** Mark Craddock
**License:** MIT
**Stars:** Growing (v4.0.0, Mar 2026)
**Status:** Very active. Already a CC plugin. Multi-platform (v4 added Codex + Gemini).

**Relationship to AgentBoot:**

| Dimension | ArcKit | AgentBoot |
|-----------|--------|-----------|
| Domain | Enterprise architecture (TOGAF, Wardley Maps, GDS) | Software engineering governance |
| Commands | 64 architecture-specific | Generic (review, test, generate) |
| Hooks | 4 automation hooks (session init, context injection, naming, validation) | Compliance hooks (PHI, credentials, audit) |
| MCP | Bundled (AWS Knowledge, MS Learn, Google Dev) | Generated from domain config |
| Distribution | CC plugin marketplace | Plugin + sync + managed settings + MCP |
| Governance | Architecture governance | AI persona governance |

**Overlap:** Hook architecture. ArcKit's 4 automation hooks (session init, project
context injection, filename enforcement, output validation) are the most mature public
example of hooks-as-governance. Their pattern of "inject project context into every
prompt" via SessionStart hook is directly applicable to AgentBoot.

**Partnership opportunity:**
- **ArcKit as an AgentBoot domain layer.** Architecture governance is a domain, not
  core. `agentboot add domain arc-kit` could import ArcKit's commands as a domain
  layer, wrapped in AgentBoot's scope hierarchy.
- **Shared hook patterns.** ArcKit's hook architecture (especially context injection
  and output validation) should inform AgentBoot's hook generation. Study their
  `hooks.json` structure before building AgentBoot's.
- **Cross-reference, don't compete.** ArcKit solves architecture governance; AgentBoot
  solves persona governance. An org could use both — ArcKit for architects, AgentBoot
  for all engineers.

**Credit approach:** Prior art acknowledgment. ArcKit's hook-as-governance pattern is
the most mature public example. ACKNOWLEDGMENTS.md + extending.md.

---

### 3. spec-kit (GitHub)

**What:** GitHub's open-source toolkit for Spec-Driven Development (SDD). Structured
process: describe what you're building → agent generates specification → specification
drives implementation. Supports 22+ AI platforms including Claude Code, Copilot,
Gemini CLI.

**Repo:** [github/spec-kit](https://github.com/github/spec-kit)
**Author:** GitHub (Microsoft)
**License:** MIT
**Stars:** Active (large community)
**Status:** Very active. 110 releases. Massive adoption.

**Relationship to AgentBoot:**

| Dimension | spec-kit | AgentBoot |
|-----------|----------|-----------|
| Phase | Before coding (specification) | During coding (review, generation, governance) |
| Focus | What to build | How to build it correctly |
| Output | Specifications (PRDs, technical designs) | Personas, traits, hooks, rules |
| Multi-platform | 22+ platforms | CC primary, Copilot/Cursor secondary |
| Governance | None | Full scope hierarchy |

**Overlap:** Almost none. spec-kit operates in the planning phase; AgentBoot operates
in the development phase. They're sequential, not competing.

**Partnership opportunity:**
- **spec-kit output feeds AgentBoot personas.** A specification generated by spec-kit
  could become input to AgentBoot's architecture reviewer persona. The spec defines
  the rules; the reviewer enforces them.
- **AgentBoot could ship a `spec-review` persona.** A persona that reviews code against
  the spec-kit-generated specification, checking that implementation matches the spec.
- **Workflow integration.** `spec-kit generate` → `agentboot build` → `agentboot sync`.
  The spec drives the persona configuration.
- **Reference in onboarding.** The `agentboot setup` wizard could ask "Do you use
  spec-driven development?" and recommend spec-kit integration if yes.

**Credit approach:** "Complementary to [spec-kit](https://github.com/github/spec-kit)
for spec-driven development workflows." In docs and getting-started guide. No code
dependency — just a workflow recommendation.

---

### 4. Trail of Bits — claude-code-config

**What:** Opinionated defaults, documentation, and workflows for Claude Code at
Trail of Bits. Covers sandboxing, permissions, hooks, skills, MCP servers. Philosophy:
"hooks are guardrails, not walls — structured prompt injection at opportune times."

**Repo:** [trailofbits/claude-code-config](https://github.com/trailofbits/claude-code-config)
**Author:** Trail of Bits (security research firm)
**License:** Not explicitly stated in search results (check repo)
**Status:** Active. Influential in the security community.

**Key philosophy:** "Hooks are not a security boundary — a prompt injection can work
around them. They are structured prompt injection at opportune times: intercepting tool
calls, injecting context, blocking known-bad patterns, and steering agent behavior.
Guardrails, not walls."

**Relationship to AgentBoot:**

| Dimension | ToB config | AgentBoot |
|-----------|-----------|-----------|
| Scope | Single developer/team | Organization |
| Focus | Security-first configuration | Governance + compliance + quality |
| Hooks | 2 blocking hooks as defaults; rest as inspiration | Generated from domain config |
| Philosophy | "Adapt, not drop-in" | "Convention over configuration" |
| Distribution | Copy/reference | Build + sync + marketplace |

**What to learn:**
- **Only 2 blocking hooks as defaults.** Everything else is "read the code, understand
  it, tailor it." AgentBoot should follow this — don't ship 20 hooks that people don't
  understand. Ship 2-3 essential ones and document the rest as templates.
- **Hooks as guardrails, not walls.** This should be AgentBoot's documented philosophy.
  Don't oversell enforcement. Be honest about what hooks can and cannot prevent.
- **`hookify` plugin.** Generates hooks from plain English. AgentBoot could learn from
  or integrate this pattern.
- **Weekly `/insights` reviews.** Continuous improvement pattern. Relevant to
  AgentBoot's self-improvement reflections concept.

**Credit approach:** Prior art acknowledgment. Their "guardrails, not walls" framing
articulates what AgentBoot independently concluded. ACKNOWLEDGMENTS.md + extending.md.

---

### 5. Trail of Bits — skills

**What:** Claude Code skills for security research, vulnerability detection, and
audit workflows. Static analysis with CodeQL/Semgrep, variant analysis, fix
verification, differential code review.

**Repo:** [trailofbits/skills](https://github.com/trailofbits/skills)
**Author:** Trail of Bits
**License:** CC-BY-SA-4.0 (Creative Commons Attribution-ShareAlike)
**Status:** Active. Multiple plugin packages (testing-handbook-skills, audit-context-building, building-secure-contracts).

**Relationship to AgentBoot:**

This is a **domain layer**, not a competing framework. ToB skills are security-domain
personas and skills that could be consumed by AgentBoot's governance system.

**Partnership opportunity:**
- **ToB skills as an AgentBoot security domain layer.** `agentboot add domain trailofbits-security`
  could import their skills into AgentBoot's scope hierarchy with proper attribution.
- **CC-BY-SA-4.0 requires ShareAlike.** Any derivative work must use the same license.
  This means AgentBoot cannot relicense ToB skills as Apache 2.0. They must remain CC-BY-SA
  in any distribution. This is fine — domain layers can have different licenses than core.

**Credit approach:** Full CC-BY-SA attribution required. Include license notice in
any distribution that includes ToB skills. Credit: "Security skills by
[Trail of Bits](https://github.com/trailofbits/skills), licensed under CC-BY-SA-4.0."

---

### 6. Other Notable Projects

| Project | What | License | Relationship |
|---------|------|---------|-------------|
| [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) | Curated list of CC skills, hooks, plugins | — | Curation; AgentBoot should be listed |
| [awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) | 135 agents, 35 skills, 150+ plugins | — | Curation; potential plugin source |
| [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) | 100+ specialized subagents | MIT | Agent library; could feed AgentBoot personas |
| [wshobson/agents](https://github.com/wshobson/agents) | Multi-agent orchestration | — | Orchestration patterns |
| [claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | Anthropic's official plugin marketplace | — | Distribution channel for AgentBoot |
| [claude-code-ultimate-guide](https://github.com/FlorianBruniaux/claude-code-ultimate-guide) | Comprehensive CC guide | — | Reference; complementary documentation |

---

## Licensing Strategy

### AgentBoot Core License

**Decision: Apache 2.0.**

Reasons:
- Maximum adoption (no friction for enterprise legal teams)
- Explicit patent grant (enterprise legal teams appreciate this over MIT)
- Compatible with all tools in the ecosystem (SuperClaude MIT, ArcKit MIT, spec-kit MIT)
- Allows orgs to create proprietary domain layers on top
- Standard for developer tooling

### Domain Layer Licenses

Domain layers can have different licenses than core:

| Layer | License | Why |
|-------|---------|-----|
| AgentBoot core | Apache 2.0 | Maximum adoption + patent grant |
| Org-specific layers | Proprietary (the org's choice) | Contains org IP |
| Community domain layers | Apache 2.0 | Community contribution |
| ToB security skills (if bundled) | CC-BY-SA-4.0 | Required by upstream license |
| Healthcare compliance domain | Apache 2.0 or proprietary | Depends on contributor |

**Key rule:** AgentBoot core must never depend on non-permissive code. Domain layers are
opt-in and carry their own licenses. The build system should include license metadata
in compiled output so orgs know what they're distributing.

### License Compatibility Matrix

| Upstream License | Can AgentBoot bundle it? | Can orgs use it? | Requirements |
|-----------------|------------------------|-----------------|-------------|
| MIT | Yes | Yes | Include license text |
| Apache-2.0 | Yes (AgentBoot's license) | Yes | Include license + NOTICE |
| CC-BY-4.0 | As domain layer only | Yes | Attribution |
| CC-BY-SA-4.0 | As domain layer only | Yes, but derivatives must be CC-BY-SA | Attribution + ShareAlike |
| GPL-3.0 | **No** (core) | As isolated domain layer only | Viral — infects everything it touches |
| Proprietary | No | N/A | N/A |

---

## Credit & Attribution Practices

### Levels of Attribution

| Level | When to Use | Format |
|-------|-------------|--------|
| **Prior art** | Independent parallel development; they shipped first | "See also [Project](url) which solves similar problems" |
| **Recommended** | Complementary tool we point users to | "Works well with [Project](url)" in docs |
| **Integrated** | Direct integration (domain layer, marketplace listing) | Attribution in domain layer README + ACKNOWLEDGMENTS |
| **Includes** | Bundled content from another project | Full license text + attribution in distribution |

### Important Context

AgentBoot's core concepts (composable traits, scope hierarchy, persona governance,
hook-based compliance, hub-and-spoke distribution) were developed independently
through real-world use across multiple projects
The third-party tools listed
here were discovered *after* the design was complete.

This is parallel evolution, not derivation. Multiple teams independently arrived at
similar patterns (composable traits, hook-based governance, agent personas) because
these are natural solutions to the same underlying problems. The third-party tools
got there first and in several cases did it better. AgentBoot acknowledges their
prior art, respects their work, and seeks to partner rather than compete.

### Current Attribution Requirements

| Project | Level | Where to Credit |
|---------|-------|----------------|
| SuperClaude | Prior art | ACKNOWLEDGMENTS.md |
| ArcKit | Prior art + recommended | ACKNOWLEDGMENTS.md, extending.md |
| spec-kit | Recommended | getting-started.md, delivery-methods.md |
| Trail of Bits config | Prior art + recommended | ACKNOWLEDGMENTS.md, extending.md |
| Trail of Bits skills | Includes (if bundled) | Full CC-BY-SA notice in domain layer |
| agentskills.io | Integrated (format standard) | README, concepts.md |

### ACKNOWLEDGMENTS.md

AgentBoot should maintain an `ACKNOWLEDGMENTS.md` at the repo root:

```markdown
# Acknowledgments

AgentBoot was developed independently through real-world use across personal projects
and engineering teams. Along the way, we discovered
that several other projects had arrived at similar patterns — in many cases earlier
and better. We acknowledge their prior art and look forward to collaborating.

## Prior Art

These projects independently developed patterns that overlap with AgentBoot's
design. We discovered them after our core design was complete.

- **[SuperClaude Framework](https://github.com/SuperClaude-Org/SuperClaude_Framework)**
  by NomenAK — composable trait architecture and cognitive persona patterns.
  The most mature public implementation of the composable-trait approach that
  AgentBoot also uses. Licensed under MIT.

- **[ArcKit](https://github.com/tractorjuice/arc-kit)** by Mark Craddock —
  enterprise governance via hooks, with the most mature public hook-as-governance
  architecture. Licensed under MIT.

- **[Trail of Bits claude-code-config](https://github.com/trailofbits/claude-code-config)**
  — production-hardened hook patterns and the "guardrails, not walls" philosophy
  that aligns with AgentBoot's approach to compliance hooks.

## Complementary Tools

These projects solve adjacent problems and work well alongside AgentBoot.

- **[spec-kit](https://github.com/github/spec-kit)** by GitHub — spec-driven
  development. Specifications feed into AgentBoot personas for enforcement.
  Licensed under MIT.

- **[Trail of Bits skills](https://github.com/trailofbits/skills)** — security
  audit skills that can be consumed as an AgentBoot domain layer.
  Licensed under CC-BY-SA-4.0.

## Standards

- **[agentskills.io](https://agentskills.io)** — open standard for agent skills,
  adopted as AgentBoot's persona definition format.

## Community

- **[awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)** —
  community curation that helped map the ecosystem.
```

---

## Partnership Models

### Model 1: Domain Layer Distribution

AgentBoot distributes third-party tools as optional domain layers:

```bash
agentboot add domain superclaude     # Import SC traits + agents
agentboot add domain arc-kit         # Import ArcKit architecture commands
agentboot add domain tob-security    # Import Trail of Bits security skills
```

**How it works:**
- Domain layer is a thin wrapper that maps the upstream project's files into
  AgentBoot's directory structure
- Upstream project's license is preserved (CC-BY-SA, MIT, etc.)
- AgentBoot's build system composes them with the org's config
- Updates tracked via upstream version pinning

**Requirements:**
- Permission from upstream maintainers (even for MIT — it's courteous)
- License compatibility verified
- Attribution in ACKNOWLEDGMENTS.md and in the domain layer's README
- `agentboot.domain.json` includes `license` and `attribution` fields

### Model 2: Plugin Marketplace Curation

AgentBoot's marketplace lists recommended third-party plugins:

```json
{
  "name": "agentboot-marketplace",
  "plugins": [
    { "name": "agentboot-core", "source": "./plugins/core" },
    { "name": "superclaude", "source": { "source": "github", "repo": "SuperClaude-Org/SuperClaude_Plugin" } },
    { "name": "arckit", "source": { "source": "github", "repo": "tractorjuice/arc-kit" } },
    { "name": "tob-security", "source": { "source": "github", "repo": "trailofbits/skills" } }
  ]
}
```

**Advantages:**
- No bundling — AgentBoot points to upstream, doesn't copy
- Always latest version (or pinned)
- No license complexity (user installs directly from upstream)
- AgentBoot acts as curator, not distributor

**This is the recommended approach** for most third-party tools. AgentBoot's value
is the governance layer, not the plugin content. Let the ecosystem produce the content;
AgentBoot organizes and distributes it.

### Model 3: Co-Development

For projects where the overlap is significant enough to warrant collaboration:

- **Joint traits.** AgentBoot + SuperClaude develop a shared trait format standard
  that both projects adopt. Traits authored in either project work in both.
- **Hook recipes.** AgentBoot + Trail of Bits publish a shared hook recipe collection
  that works standalone or within AgentBoot's build system.
- **Architecture integration.** AgentBoot + ArcKit define how architecture governance
  and persona governance compose (e.g., ArcKit's architecture commands as AgentBoot
  personas with scope hierarchy).

This requires active maintainer relationship and isn't feasible until AgentBoot has
users and credibility.

### Model 4: Upstream Contribution

When AgentBoot develops something useful to the ecosystem:

- **Trait format spec.** If AgentBoot defines a formal trait composition spec that's
  better than what exists, contribute it upstream to agentskills.io.
- **Governance patterns.** Document scope hierarchy, managed settings patterns, and
  hook generation as reusable patterns that other frameworks can adopt.
- **Cross-platform output.** The multi-format compilation approach (CC + Copilot +
  Cursor from single source) could become a community standard.

---

## Competitive Positioning

AgentBoot is **not competing** with these tools. It's solving a different problem:

| Tool | Problem | Audience |
|------|---------|----------|
| SuperClaude | "I want better Claude Code behavior" | Individual developer |
| ArcKit | "I need systematic architecture governance" | Enterprise architects |
| spec-kit | "I need specifications before coding" | Teams starting projects |
| Trail of Bits | "I need security-focused AI tooling" | Security researchers/auditors |
| **AgentBoot** | "I need to govern AI behavior across my org" | Platform teams, engineering leadership |

The differentiator: **AgentBoot is the governance and distribution layer.** It doesn't
compete with the content (traits, agents, skills) — it governs and distributes them.
An org could use SuperClaude's traits, ArcKit's architecture commands, and ToB's
security skills, all composed and distributed through AgentBoot's scope hierarchy.

Think of it like: npm doesn't compete with React. npm distributes React. AgentBoot
doesn't compete with SuperClaude. AgentBoot distributes SuperClaude (along with
everything else, governed).

---

## Sources

- [SuperClaude Framework — GitHub](https://github.com/SuperClaude-Org/SuperClaude_Framework) (MIT)
- [SuperClaude Plugin — GitHub](https://github.com/SuperClaude-Org/SuperClaude_Plugin)
- [ArcKit — GitHub](https://github.com/tractorjuice/arc-kit) (MIT)
- [ArcKit 2.0 — Now a Claude Code Plugin (Medium)](https://medium.com/arckit/arckit-2-0-now-a-claude-code-plugin-18a55f46828a)
- [ArcKit v4: First-Class Codex and Gemini Support (Medium)](https://medium.com/arckit/arckit-v4-first-class-codex-and-gemini-support-with-hooks-mcp-servers-and-native-policies-abdf9569e00e)
- [spec-kit — GitHub](https://github.com/github/spec-kit) (MIT)
- [Spec-driven development with AI (GitHub Blog)](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/)
- [Trail of Bits claude-code-config — GitHub](https://github.com/trailofbits/claude-code-config)
- [Trail of Bits skills — GitHub](https://github.com/trailofbits/skills) (CC-BY-SA-4.0)
- [awesome-claude-code — GitHub](https://github.com/hesreallyhim/awesome-claude-code)
- [awesome-claude-code-toolkit — GitHub](https://github.com/rohitg00/awesome-claude-code-toolkit)
- [Claude Code Plugins Official — GitHub](https://github.com/anthropics/claude-plugins-official)
