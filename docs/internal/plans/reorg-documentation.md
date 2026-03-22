# Documentation Reorganization Plan

**Date:** 2026-03-21
**Status:** Phase A complete. Phase B (Docusaurus setup) pending.
**Scope:** All 35 documentation files (23,258 lines) across `docs/`, `docs/plans/`, `docs/internal/`, `docs/claude-code-reference/`, and root-level files

---

## 1. Current State

### Inventory

| Location | Files | Lines | Purpose |
|----------|-------|-------|---------|
| Root (`*.md`) | 4 | ~500 | Public-facing: README, TRADEMARK, ACKNOWLEDGMENTS, CLAUDE.md |
| `docs/` | 15 | ~9,800 | Core concepts, guides, analysis, reference |
| `docs/plans/` | 5 | ~9,350 | PRD, architecture, technical-spec, design, stack-rank |
| `docs/claude-code-reference/` | 3 | ~1,400 | CC feature inventory and gap analysis |
| `docs/internal/` | 9 + 1 dir | ~2,200 | Strategy, marketing, founding context, exploratory |
| `docs/internal/persona-origins/` | 11 | gitignored | Confidential evolution history |
| **Total** | **47** | **~23,258** | |

### Health Assessment

**What's strong:**
- Core concept docs (concepts, getting-started, extending, configuration) are current and well-structured
- Planning docs form a coherent chain: PRD -> architecture -> technical-spec -> design
- Privacy doc is a key differentiator, well-written and trust-building
- Pre-release QA audits (cli-commands-audit, config-schema-audit) identify real actionable issues
- `persona-origins/` is excellent institutional knowledge (stays gitignored)

**What's weak:**
- 15 audit doubts (AD-01 through AD-15) about Claude Code behavior remain unvalidated
- Several docs describe unimplemented Phase 2+ features without clear "planned" markers
- No troubleshooting guide, migration guide, or changelog
- Some internal docs contain sensitive employment/org context
- No clear separation between "public documentation" and "internal planning"

---

## 2. Target Architecture

### Two-tier documentation model

```
docs/                           # PUBLIC — ships with repo, hosts on agentboot.dev
  getting-started.md            # First-time quickstart
  concepts.md                   # Core abstractions
  configuration.md              # Config reference
  extending.md                  # Domain layers, custom personas
  cli-reference.md              # All CLI commands (merged from cli-design + audit)
  privacy.md                    # Privacy and safety philosophy
  prompt-guide.md               # Prompt optimization best practices
  model-selection.md            # Haiku/Sonnet/Opus guidance
  ci-cd.md                      # CI/CD integration
  delivery-methods.md           # How orgs distribute AgentBoot
  org-connection.md             # How developers get their org's config
  marketplace.md                # Community sharing vision
  roadmap.md                    # Public roadmap (from stack-rank)
  glossary.md                   # Extracted from PRD
  troubleshooting.md            # NEW: common issues and fixes

docs/plans/                     # INTERNAL — design docs, not public
  prd.md                        # Product requirements
  architecture.md               # System architecture + ADRs
  technical-spec.md             # Implementation blueprint
  design.md                     # UX, privacy, marketplace design
  stack-rank.md                 # Feature priority (source for public roadmap)
  reorg-documentation.md        # This file

docs/internal/                  # INTERNAL — strategy, operations
  open-questions.md             # Consolidated Q&A database
  new-ideas.md                  # Exploratory design concepts
  name-claiming.md              # Platform name reservation playbook
  licensing-trademark.md        # Legal strategy + CLA setup
  marketing-slicks.md           # Audience-specific positioning
  persona-origins/              # (gitignored, unchanged)

docs/internal/archive/          # ARCHIVED — completed work, historical
  WORK-IN-PROGRESS.md           # Founding session context
  audit-findings.md             # Phase 3 audit (completed)
  marketing-plan.md             # Contains sensitive employment context
  cli-commands-audit.md         # Pre-release QA (findings resolved or tracked)
  config-schema-audit.md        # Pre-release QA (findings resolved or tracked)

docs/claude-code-reference/     # INTERNAL — CC feature knowledge base
  README.md                     # (keep)
  feature-inventory.md          # (keep, verify before publishing)
  agentboot-coverage.md         # (keep)
```

### Key changes

| Action | Files | Rationale |
|--------|-------|-----------|
| **Archive** | WORK-IN-PROGRESS.md | v0.2.0 shipped; explicitly marked "delete after v0.1.0" |
| **Archive** | audit-findings.md | Phase 3 audit complete; all issues resolved |
| **Archive** | marketing-plan.md | Contains sensitive employment context; core strategy extractable |
| **Archive** | cli-commands-audit.md | Convert actionable items to GitHub Issues first |
| **Archive** | config-schema-audit.md | Convert actionable items to GitHub Issues first |
| **Merge** | cli-design.md + cli-commands-audit fixes -> cli-reference.md | Single CLI reference instead of design + audit |
| **Rename** | privacy-and-safety.md -> privacy.md | Shorter, cleaner URL |
| **Rename** | prompt-optimization.md -> prompt-guide.md | User-facing naming |
| **Rename** | model-selection-matrix.md -> model-selection.md | Simpler |
| **Rename** | developer-onboarding.md -> (merge into getting-started.md) | Avoid fragmentation |
| **Rename** | third-party-ecosystem.md -> (merge into marketplace.md) | Avoid fragmentation |
| **Rename** | test-plan.md -> (stays in docs/plans/) | Not public |
| **Rename** | knowledge-layer.md -> (stays in docs/plans/) | Not public until Stage 2 |
| **Create** | docs/glossary.md | Extract from PRD's 40+ term glossary |
| **Create** | docs/roadmap.md | Public version of stack-rank (phases + status) |
| **Create** | docs/troubleshooting.md | Common issues (referenced in getting-started) |

---

## 3. Archiving Plan

### Move to `docs/internal/archive/`

These files have served their purpose. They remain in git history and in the archive directory for reference, but are no longer active documentation.

| File | Current Location | Archive As | Reason |
|------|------------------|------------|--------|
| WORK-IN-PROGRESS.md | docs/internal/ | archive/founding-session.md | v0.2.0 shipped; founding context preserved |
| audit-findings.md | docs/internal/ | archive/phase3-audit.md | All 46 findings resolved |
| marketing-plan.md | docs/internal/ | archive/marketing-plan-2026Q1.md | Contains sensitive dual-employment context |
| cli-commands-audit.md | docs/ | archive/cli-commands-audit.md | Convert items to Issues first |
| config-schema-audit.md | docs/ | archive/config-schema-audit.md | Convert items to Issues first |

### Pre-archive action items

Before archiving the audit docs, extract unresolved items:

**From cli-commands-audit.md (3 critical + 7 high):**
1. `--fix` flag documented but not implemented in `lint`
2. `--config` appears on both global and per-command levels (ambiguous)
3. `config` command is read-only (should write or document limitation)
4. `--repos-file` vs `--repos` naming inconsistency
5. `dev-sync`/`dev-build` are hidden commands (document or remove)

**From config-schema-audit.md (2 critical + 5 high):**
1. `groups[].label` field defined but never used
2. `personas.customDir` unclear naming (should be `personas.extensionDir`)
3. `repos[].platform` accepts values for unimplemented formats
4. `tokenBudget` unclear whether it's per-persona or total
5. Phase 2 features exposed in schema before implementation

---

## 4. Deduplication Plan

### Overlapping content to consolidate

| Topic | Currently In | Consolidate To | Action |
|-------|-------------|----------------|--------|
| CLI commands reference | cli-design.md, technical-spec.md Section 3, CLAUDE.md | docs/cli-reference.md | Create single CLI reference; cli-design becomes design rationale in plans/ |
| Privacy model | privacy-and-safety.md, design.md Section 3 | docs/privacy.md | Keep standalone; cross-ref from design.md |
| Trait weight system | concepts.md, technical-spec.md, persona.config.json schema | concepts.md | Mark as "Phase 2 planned" everywhere; single canonical description |
| Scope hierarchy | concepts.md, architecture.md Section 5, CLAUDE.md | concepts.md (public), architecture.md (internal) | Good separation already; just add cross-refs |
| Developer onboarding | developer-onboarding.md, getting-started.md | getting-started.md (quick) + onboarding tips in docs/ | Merge intro content; keep onboarding as separate tips guide |
| Third-party ecosystem | third-party-ecosystem.md, ACKNOWLEDGMENTS.md, marketplace.md | marketplace.md (ecosystem section) + ACKNOWLEDGMENTS.md | Merge ecosystem positioning into marketplace; keep ACKNOWLEDGMENTS for credits |
| CC feature reference | feature-inventory.md, agentboot-coverage.md | Keep separate (different purposes) | Inventory = reference, Coverage = gap analysis |

### Files to merge

1. **cli-design.md + cli-commands-audit fixes -> cli-reference.md**
   - Extract command signatures, flags, examples from cli-design.md
   - Incorporate audit fixes (naming consistency, missing flags)
   - Move design rationale to docs/plans/cli-design.md (internal)

2. **developer-onboarding.md -> getting-started.md**
   - Getting-started already covers quickstart
   - Onboarding "tips system" content (contextual hints, /learn skill) is Phase 4; keep as `docs/onboarding.md` stub

3. **third-party-ecosystem.md -> marketplace.md**
   - Ecosystem analysis + competitive positioning -> marketplace.md "Ecosystem" section
   - Partnership models -> marketplace.md "Partnerships" section
   - Credit/licensing -> ACKNOWLEDGMENTS.md already covers this

4. **test-plan.md + knowledge-layer.md -> docs/plans/**
   - These are internal planning; not public docs
   - Move to docs/plans/ if not already there

---

## 5. Content Freshness Fixes

### Phase markers needed

These docs reference features as if implemented when they are Phase 2+:

| Doc | Section | Issue | Fix |
|-----|---------|-------|-----|
| concepts.md | Trait weight system | Reads as if weights (HIGH/MEDIUM/LOW) exist | Add: "**Planned (Phase 2):** Trait weights..." |
| concepts.md | Creative-suggestion trait | Referenced but not implemented | Add: "**Planned:**" marker |
| ci-cd-automation.md | Copilot/Gemini CLI flags | Unverified flags for non-CC platforms | Add: "**Unverified:**" markers; verify against official docs |
| technical-spec.md | Multiple Phase 2+ features | Some commands specified but unimplemented | Update status column in each table |
| developer-onboarding.md | /learn skill, contextual tips | Phase 4 features | Add clear phase markers |

### Audit doubts to resolve

From `docs/internal/open-questions.md`, 15 assumptions need validation:

| ID | Assumption | Risk |
|----|-----------|------|
| AD-01 | CC plugin structure matches documented format | HIGH — plugin export depends on this |
| AD-02 | SuperClaude star counts and feature claims | LOW — cosmetic |
| AD-03 | Copilot CLI flags for headless mode | MEDIUM — CI docs reference these |
| AD-04 | Gemini CLI flags | MEDIUM — CI docs reference these |
| AD-05 | CC has exactly 35 tools | LOW — inventory detail |
| AD-06 | CC has exactly 25 hook events | MEDIUM — hook generation depends on this |
| AD-07 | CC reads .mcp.json from project root | HIGH — MCP config generation |
| AD-08 | CC managed settings path for Jamf | MEDIUM — managed settings output |
| AD-09 | CC version that supports all referenced features | MEDIUM — compatibility claims |
| AD-10–15 | Various CC behavior assumptions | MEDIUM — various features |

---

## 6. Public Documentation Site (agentboot.dev)

### Hosting: GitHub Pages from this repo

```
/                               # GitHub Pages site root
  index.html                    # Landing page (generated from README)
  /docs/                        # Documentation (from docs/*.md)
    getting-started/
    concepts/
    configuration/
    extending/
    cli-reference/
    privacy/
    prompt-guide/
    model-selection/
    ci-cd/
    delivery-methods/
    org-connection/
    marketplace/
    roadmap/
    glossary/
    troubleshooting/
```

### Site generator: Docusaurus

**Decision:** [Docusaurus](https://docusaurus.io/) (React-based, maintained by Meta)
- Better search (Algolia DocSearch integration)
- Built-in versioning for docs across releases
- Blog plugin for announcements
- i18n support for future localization
- MDX support for interactive components
- Active community and long-term maintenance

### Approach (phased)

1. **Phase A (complete):** Reorganize docs per this plan.
2. **Phase B (pre-launch):** Add Docusaurus config, sidebar nav, deploy to GitHub Pages.
3. **Phase C (post-launch):** Add Algolia search, versioning, analytics.

### Navigation structure for agentboot.dev

```yaml
sidebar:
  - text: "Getting Started"
    items:
      - { text: "Introduction", link: "/docs/getting-started" }
      - { text: "Core Concepts", link: "/docs/concepts" }
      - { text: "Configuration", link: "/docs/configuration" }

  - text: "Guides"
    items:
      - { text: "Extending AgentBoot", link: "/docs/extending" }
      - { text: "CLI Reference", link: "/docs/cli-reference" }
      - { text: "Prompt Authoring", link: "/docs/prompt-guide" }
      - { text: "Model Selection", link: "/docs/model-selection" }
      - { text: "CI/CD Integration", link: "/docs/ci-cd" }

  - text: "For Organizations"
    items:
      - { text: "Delivery Methods", link: "/docs/delivery-methods" }
      - { text: "Org Connection", link: "/docs/org-connection" }
      - { text: "Privacy & Safety", link: "/docs/privacy" }

  - text: "Community"
    items:
      - { text: "Marketplace", link: "/docs/marketplace" }
      - { text: "Roadmap", link: "/docs/roadmap" }
      - { text: "Contributing", link: "/CONTRIBUTING" }

  - text: "Reference"
    items:
      - { text: "Glossary", link: "/docs/glossary" }
      - { text: "Troubleshooting", link: "/docs/troubleshooting" }
```

---

## 7. Domain Strategy

### agentboot.dev (primary)

**Purpose:** Community-centered documentation, adoption, open source presence
**Content:**
- All public documentation (from `docs/`)
- Getting started guides
- CLI reference
- Privacy philosophy
- Roadmap
- Contributing guide
- Community marketplace (Phase 5)
- Blog (post-launch)

**Hosting:** GitHub Pages from `main` branch, `docs/` directory
**DNS:** Point agentboot.dev A/CNAME to GitHub Pages
**SSL:** GitHub Pages provides free SSL

### agentboot.io (commercial, redirects for now)

**Purpose:** Future commercial presence — paid features, consulting, enterprise support
**Content (future):**
- Enterprise features (SSO, SAML, advanced telemetry dashboards)
- Managed marketplace hosting
- Consulting services (persona audits, compliance reviews)
- Training and certification
- SLA support plans

**Current state:** DNS redirect `agentboot.io -> agentboot.dev`
**Implementation:**
```
# DNS A record for agentboot.io -> redirect service (e.g., Cloudflare page rule)
# Or: agentboot.io CNAME -> redirect.agentboot.dev (GitHub Pages redirect)
```

**When to activate agentboot.io:**
- When there is a paid feature to sell (enterprise telemetry dashboard, managed compliance)
- When consulting demand justifies a separate brand presence
- Estimated: Phase 5+ or when first enterprise customer requires it

### Domain ownership checklist

| Domain | Status | Action |
|--------|--------|--------|
| agentboot.dev | Owned | Configure GitHub Pages |
| agentboot.io | Owned | Configure redirect to agentboot.dev |
| agentboot.com | Check | Acquire if available (brand protection) |

---

## 8. Execution Plan

### Phase A: Reorganize (this sprint)

| Step | Action | Files Affected |
|------|--------|---------------|
| 1 | Create `docs/internal/archive/` | New directory |
| 2 | Archive 5 files (see Section 3) | Move files |
| 3 | Extract audit items to GitHub Issues | cli-commands-audit, config-schema-audit |
| 4 | Rename files per Section 2 | 4 renames |
| 5 | Merge cli-design + audit -> cli-reference.md | Create new, archive old |
| 6 | Merge third-party-ecosystem -> marketplace.md | Edit marketplace, archive ecosystem |
| 7 | Add Phase 2+ markers to concepts.md, ci-cd-automation.md | Edit in place |
| 8 | Create glossary.md (extract from PRD) | New file |
| 9 | Create roadmap.md (public version of stack-rank) | New file |
| 10 | Create troubleshooting.md (stub) | New file |
| 11 | Move test-plan.md, knowledge-layer.md to docs/plans/ | Move files |

### Phase B: Site setup (pre-launch)

| Step | Action |
|------|--------|
| 1 | Choose site generator (VitePress recommended) |
| 2 | Add config file (`.vitepress/config.ts` or `docusaurus.config.js`) |
| 3 | Add sidebar navigation per Section 6 |
| 4 | Configure GitHub Pages deployment (GitHub Actions workflow) |
| 5 | Point agentboot.dev DNS to GitHub Pages |
| 6 | Configure agentboot.io redirect |
| 7 | Test all pages render correctly |

### Phase C: Polish (post-launch)

| Step | Action |
|------|--------|
| 1 | Add search (Algolia DocSearch or local search) |
| 2 | Add version selector (if docs diverge across releases) |
| 3 | Add analytics (Plausible or Simple Analytics — privacy-respecting) |
| 4 | Add "Edit this page" links to GitHub |
| 5 | Add API reference (generated from TypeScript types) |

---

## 9. Content Not Touched

Per instructions, these are analyzed but not modified:

### `docs/internal/persona-origins/`

**Files:** 11 (8 origin docs, README, best-ideas.md, duplicate-analysis.md)
**Status:** Gitignored, confidential, historically complete
**Assessment:** Excellent institutional knowledge. The `best-ideas.md` synthesis is Tier-ranked and well-executed. Individual origin docs (O1-O8) trace the full evolution from Sonnet design exercise through enterprise deployment.
**Relevance post-Phase 3:** All Tier 1 ideas are implemented. Tier 2 ideas (gotchas rules, compliance hooks, behavioral tests) are partially implemented. Tier 3 ideas (autonomy progression, persona arbitrator) are Phase 5.
**Recommendation:** No changes. Ensure `.gitignore` entry persists. Consider referencing in a future "History" document for open-source contributors.

---

## 10. Success Criteria

The reorganization is complete when:

1. Every public doc in `docs/` is current, audience-appropriate, and free of "planned as implemented" confusion
2. Internal docs are cleanly separated in `docs/plans/` and `docs/internal/`
3. Archived docs are in `docs/internal/archive/` with completion notes
4. No duplicate content exists across public docs (single source of truth per topic)
5. `agentboot.dev` serves the public docs via GitHub Pages
6. `agentboot.io` redirects to `agentboot.dev`
7. All 15 audit doubts (AD-01 through AD-15) are resolved or documented as known limitations
8. Pre-release QA items from archived audits are tracked as GitHub Issues
