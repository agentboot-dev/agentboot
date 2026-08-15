/**
 * D2: platform conformance test harness + per-platform enforcement manifest.
 *
 * B12 documented enforcement honesty (which platforms enforce, which are
 * advisory). This module converts those claims into a TESTED contract:
 *
 *  - `PLATFORM_ENFORCEMENT` is the single source of truth for the declared
 *    enforcement level per platform (doctor reads it too).
 *  - The harness EXECUTES the compiled hook scripts with crafted inputs —
 *    clean, secret-bearing, malformed, deny-listed tool — and records
 *    observed exit codes and blocking decisions against expectations.
 *  - Results land in `dist/<platform>/enforcement-manifest.json`: a
 *    machine-readable statement of which controls exist on that platform,
 *    what level they are declared at, and what the probes actually observed.
 *
 * Honesty rules: a control that cannot be probed (no bash, script absent) is
 * "untested", never "pass". Advisory platforms get a manifest stating plainly
 * that no enforcement mechanism exists. Nothing is fabricated at compile time
 * — empirical fields only exist after a real harness run.
 *
 * And "untested" is not a green result. Recording it truthfully in the manifest
 * was only half the rule: the RUN must also refuse to report success, or a
 * machine without bash produces a full sheet of `untested` under the line
 * "✓ All probed controls behave as declared" and exit 0. A skip must alarm as
 * loudly as a failure — see `untestedPlatforms` / `probedControls` below.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PLATFORM_REQUIRES, DEFAULT_OUTPUT_FORMATS, type AgentBootConfig } from "./config.js";
import { APPLY_TO_PROJECTION } from "./scope-projection.js";
import type { PersonaScopeCounts } from "./guardrail-scan.js";

/** Same bound as every external-binary probe (v0.12.4 hang-class fix). */
const PROBE_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Declared enforcement levels — SSOT (doctor imports this)
// ---------------------------------------------------------------------------

export interface PlatformEnforcement {
  level: "enforced" | "partial" | "fail-open" | "advisory";
  detail: string;
  /**
   * B2: other output formats that must ALSO be built for this platform's
   * enforcement mechanism to exist at all.
   *
   * `plugin` does not have hooks of its own — it bundles Claude Code's, copied
   * out of dist/claude/ by an emitter that only runs when `claude` is built. On
   * a plugin-only hub dist/plugin/ has no hooks.json, so the declared level
   * `enforced` describes a mechanism that is not present. A level is a claim
   * about an artifact; when the artifact is absent the claim must not be made.
   */
  requires?: string[];
}

export const PLATFORM_ENFORCEMENT: Record<string, PlatformEnforcement> = {
  claude: { level: "enforced", detail: "hooks block (exit 2); managed settings via the MDM channel are non-overridable" },
  codex: { level: "partial", detail: "hooks emitted with partial event coverage; managed-settings ceiling is lower than Claude Code" },
  copilot: { level: "fail-open", detail: "command hooks time out OPEN — a hung or slow hook does not block" },
  cursor: { level: "advisory", detail: "instructions only — no hook binding, nothing is enforced" },
  gemini: { level: "advisory", detail: "instructions only — no hook binding" },
  windsurf: { level: "advisory", detail: "instructions only — no hook binding" },
  jetbrains: { level: "advisory", detail: "instructions only — no hook binding" },
  agents: { level: "advisory", detail: "AGENTS.md is instructions only" },
  skill: { level: "advisory", detail: "skill content is instructions only" },
  plugin: { level: "enforced", requires: PLATFORM_REQUIRES["plugin"]!, detail: "bundles Claude Code hooks — enforcement is Claude Code's, via the plugin's hooks.json" },
};

export interface EnforcementResolution {
  level: PlatformEnforcement["level"];
  detail: string;
  /** Declared prerequisites that this build does NOT satisfy. */
  unmetRequires: string[];
}

/**
 * The enforcement level a platform ACTUALLY has in a given build.
 *
 * One resolver, used by the HARD-guardrail gate and by doctor, because two
 * places deciding "is `plugin` enforcing?" is the drift that produced
 * `✓ plugin: org policy is enforceable` on a hub whose dist/plugin/ contained no
 * hooks.json at all.
 *
 * FAILS CLOSED twice over: an unknown platform resolves to `advisory`, and a
 * platform whose prerequisites are unmet resolves to `advisory` rather than to
 * its declared level. "We could not verify it" must never resolve upward.
 */
/**
 * R1-G: THE platform set, for every consumer that needs one.
 *
 * `conformance` derived it from `personas.outputFormats`; `evidence-pack`
 * derived it from `fs.readdirSync(distPath)`. Two lists that must agree, and
 * they did not: `dist/plugin/` is emitted whenever `claude` is built
 * (generatePluginOutput sits inside `if (outputFormats.includes("claude"))`)
 * even though `plugin` is not a configured format. So on a claude-only hub the
 * evidence pack printed `UNPROBED: plugin (run agentboot conformance)` and
 * `agentboot conformance` would never probe plugin, because it iterates the
 * config. The remedy the pack printed could not resolve the state the pack
 * reported — permanently, on every pack.
 *
 * One resolver, and consumers that state which set they used.
 */
export function configuredPlatforms(config: {
  personas?: { outputFormats?: string[] } | undefined;
}): string[] {
  return config.personas?.outputFormats ?? [...DEFAULT_OUTPUT_FORMATS];
}

export function resolveEnforcement(
  format: string,
  outputFormats: readonly string[],
): EnforcementResolution {
  const e = PLATFORM_ENFORCEMENT[format];
  if (!e) {
    return {
      level: "advisory",
      detail: "no enforcement classification for this platform",
      unmetRequires: [],
    };
  }
  const unmet = (e.requires ?? []).filter((r) => !outputFormats.includes(r));
  if (unmet.length > 0) {
    return {
      level: "advisory",
      detail:
        `${e.detail} — but ${unmet.join(", ")} is not in personas.outputFormats, ` +
        `so no hooks are produced for this platform at all`,
      unmetRequires: unmet,
    };
  }
  return { level: e.level, detail: e.detail, unmetRequires: [] };
}

// ---------------------------------------------------------------------------
// Capability × platform SUPPORT — the second, orthogonal axis
// ---------------------------------------------------------------------------

/**
 * `PLATFORM_ENFORCEMENT` answers "how strongly does platform P enforce?".
 * Nothing in the codebase answered "which platforms EMIT capability C?", so the
 * intersection of configured capabilities with configured platforms was never
 * computed — and an empty intersection was indistinguishable from a correct
 * build. Eight capabilities passed `build`, `validate --strict` AND `doctor`
 * with zero mention (confirmed 2026-08-08).
 *
 * The two axes are deliberately kept separate. Restating enforcement strength
 * here would create a second, drifting copy of the first table, which is exactly
 * how `plugin` came to be in `validFormats` but not in `PLATFORM_ENFORCEMENT`.
 * Support = "is there a mechanism at all". Enforcement = "how strong is it".
 */

export interface CapabilityContext {
  config: AgentBootConfig;
  /** Instructions whose `applyTo` NARROWS scope (present, and not "**"/"**\/*"). */
  narrowlyScopedInstructions: number;
  /** Gotchas carrying a `paths:` value. */
  scopedGotchas: number;
  /**
   * R2-9 / NF3-5 / NF3-4: controls declared in persona.config.json.
   *
   * Every row below keys off AgentBootConfig, so this context could not SEE
   * persona.config.json and the whole persona scope was invisible to the gate.
   * A persona-declared PreToolUse hook is a blocking control of the same class
   * as `claude.hooks` (severity error) and vanished, silently, on any hub
   * without `claude` in outputFormats.
   */
  personaControls: PersonaScopeCounts;
}

export interface CapabilityRow {
  /** The key as the operator writes it in agentboot.config.json. Printed verbatim. */
  id: string;
  /** Is it configured? */
  detect: (ctx: CapabilityContext) => boolean;
  /** Platforms whose compiled dist tree contains a mechanism acting on this key.
   *  EMPTY ARRAY means: implemented on no platform, at all.
   *
   *  This is the DECLARED set — what the platform is capable of carrying. It is
   *  not, on its own, what a given build emits: see `conditionalOn`. */
  emittedBy: string[];
  /**
   * B1: emission preconditions, platform → other output formats that must ALSO
   * be built for that platform's emitter to run.
   *
   * `emittedBy` is a flat list and therefore cannot express the one thing that
   * is true of `plugin`: the plugin tree is assembled by copying artifacts out
   * of `dist/claude/`, and both `generatePluginOutput` and
   * `generateComplianceHooks` sit INSIDE `if (outputFormats.includes("claude"))`
   * in compile.ts. On a `plugin`-only hub those emitters never run, `dist/plugin/`
   * comes out near-empty, and four error-severity rows claimed the capability was
   * honoured — so the gate stayed silent about a control that reached nothing.
   *
   * Modelling this as data rather than as a special case in the gate is
   * deliberate: the next platform with a build-order dependency gets a row, not
   * a second `if`.
   */
  conditionalOn?: Record<string, string[]>;
  /** Severity when emittedBy ∩ outputFormats is empty. */
  severity: "error" | "warn";
  /** What the operator actually loses. Printed under the finding. */
  consequence: string;
  /**
   * NEW-3: which `agentboot.config.json` path this row governs, for the
   * CONFIG_SHAPE completeness invariant.
   *
   * `undefined` — derive it from `id` (the common case; `groups[].x` maps to
   *     `groups.*.x`).
   * `null`      — this row is NOT an agentboot.config.json key. Artifact
   *     frontmatter (`instructions[].applyTo`, `gotchas[].paths`) and
   *     persona.config.json (`personas[*].*`) live in other files and have no
   *     business in a table that types the hub config.
   *
   * Explicit rather than pattern-matched on the id, because "which of these ids
   * is a config key" is exactly the judgement that a regex gets wrong silently.
   */
  configPath?: string | null;
  /** file:line of the emitter, so a reviewer can check the row against the code.
   *  An unverified row here is the same class of error as an unsourced claim. */
  warrant: string;
}

/**
 * Every `emittedBy` set below was OBSERVED — a hub was built with all hook
 * platforms configured and `dist/` grepped for the configured value — not
 * inferred from the gate structure. Two of them correct the research matrix:
 * `plugin` does NOT carry `claude.hooks` (it carries the generated compliance
 * hooks only), and `plugin`/`copilot` DO receive the denyTools PreToolUse hook.
 */
/**
 * NF2-3: the platforms that CAN express a path scope, derived from the ONE table
 * that answers that question.
 *
 * `instructions[].applyTo` declared `emittedBy: ["copilot"]` while
 * APPLY_TO_PROJECTION in this same repo classifies cursor, windsurf and
 * jetbrains as `translated` — and all three demonstrably emit a real, functional
 * scope (`globs:` + `alwaysApply: false`, `trigger: glob` + `globs:`, and
 * `globs: [...]` respectively, verified in the emitted frontmatter). The
 * under-declaration was then wired into an operator-facing sentence:
 *
 *   "instructions[].applyTo - configured, but needs one of: copilot"
 *      (on a hub where cursor ALREADY received the scope)
 *   "…reaches copilot but NOT claude, cursor, windsurf, jetbrains;
 *    on those targets this control is absent, not weaker"
 *      (false for three of the four)
 *
 * Two lists that must agree, with nothing asserting it — and the sibling row
 * `gotchas[].paths` had the correct four, which is what an unasserted invariant
 * looks like from the inside. Derived here so the disagreement is not
 * expressible.
 */
export const SCOPE_EMITTERS: string[] = Object.entries(APPLY_TO_PROJECTION)
  .filter(([, p]) => p.support === "native" || p.support === "translated")
  .map(([name]) => name)
  .sort();

export const CAPABILITY_SUPPORT: CapabilityRow[] = [
  {
    id: "claude.hooks",
    detect: (c) => Object.keys(c.config.claude?.hooks ?? {}).length > 0,
    emittedBy: ["claude"],
    severity: "error",
    consequence: "Org-authored PreToolUse/PostToolUse gates produce no file. Nothing runs.",
    warrant: "scripts/compile.ts:1742",
  },
  {
    id: "claude.permissions.deny",
    detect: (c) => (c.config.claude?.permissions?.deny?.length ?? 0) > 0,
    emittedBy: ["claude"],
    severity: "error",
    consequence: "The deny list is applied on no target.",
    warrant: "scripts/compile.ts:1742",
  },
  {
    id: "claude.permissions.allow",
    // WARN, not ERROR, and the asymmetry with `deny` is deliberate: `deny` is
    // the control (its absence means a forbidden action is permitted); `allow`
    // is a pre-approval convenience (its absence means the developer gets
    // prompted). Failing a build over lost friction-reduction is the
    // over-gating that gets a gate switched off. `hasHardPolicy` in doctor
    // already draws this exact line.
    detect: (c) => (c.config.claude?.permissions?.allow?.length ?? 0) > 0,
    emittedBy: ["claude"],
    severity: "warn",
    consequence: "Pre-approvals are not applied; developers get prompted where they would have been auto-approved.",
    warrant: "scripts/compile.ts:1742",
  },
  {
    id: "claude.mcpServers",
    detect: (c) => Object.keys(c.config.claude?.mcpServers ?? {}).length > 0,
    emittedBy: ["claude"],
    severity: "warn",
    consequence: "The org's MCP servers reach no runtime.",
    warrant: "scripts/compile.ts:1799",
  },
  {
    id: "claude.settings",
    detect: (c) => Object.keys(c.config.claude?.settings ?? {}).length > 0,
    emittedBy: ["claude"],
    severity: "warn",
    consequence: "Pass-through settings are written to no managed fragment.",
    warrant: "scripts/compile.ts:3421",
  },
  /**
   * R2-3: the GROUP-scope twins of the four `claude.*` rows above.
   *
   * `groups[name].permissions`, `.mcpServers` and `.enabledPlugins` are the
   * documented way an org expresses per-group managed settings
   * (docs/configuration.md:81). They are emitted by ONE block —
   * `if (outputFormats.includes("claude"))` at compile.ts:4327 — and had no row
   * here at all, so the whole group tier was invisible to the gate whose entire
   * job is "configured, but no configured platform can honour it".
   *
   * Observed on a scratch hub (`groups.platform.permissions.deny`,
   * `.mcpServers`, `.enabledPlugins`, outputFormats `["cursor","copilot"]`):
   *
   *     BUILD_EXIT=0
   *     grep -rl 'rm -rf' dist   → (nothing)
   *     doctor Coverage          → silent on all three
   *
   * Two org-wide deny rules gone, green build, nothing said — while the
   * org-level `claude.permissions.deny` row would have failed the build for the
   * identical control written one scope up.
   *
   * SEVERITY RULE, so it is not a judgement call per row: a group-scope key
   * takes the SAME severity as its org-level twin. `deny` is the control (its
   * absence permits a forbidden action) so it is `error`; `allow`, `mcpServers`
   * and `enabledPlugins` follow their twins at `warn`. Inventing a different
   * ladder for the same key at a different scope is how two tables that must
   * agree start to drift.
   */
  {
    id: "groups[].permissions.deny",
    detect: (c) =>
      Object.values(c.config.groups ?? {}).some((g) => (g?.permissions?.deny?.length ?? 0) > 0),
    emittedBy: ["claude"],
    severity: "error",
    consequence: "Group-scope deny lists are applied on no target; the group's forbidden tools run.",
    warrant: "scripts/compile.ts:4346",
  },
  {
    id: "groups[].permissions.allow",
    detect: (c) =>
      Object.values(c.config.groups ?? {}).some((g) => (g?.permissions?.allow?.length ?? 0) > 0),
    emittedBy: ["claude"],
    severity: "warn",
    consequence: "Group-scope pre-approvals are not applied; the group's developers get prompted.",
    warrant: "scripts/compile.ts:4346",
  },
  {
    id: "groups[].mcpServers",
    detect: (c) =>
      Object.values(c.config.groups ?? {}).some(
        (g) => Object.keys(g?.mcpServers ?? {}).length > 0,
      ),
    emittedBy: ["claude"],
    severity: "warn",
    consequence: "The group's MCP servers reach no runtime.",
    warrant: "scripts/compile.ts:4347",
  },
  {
    id: "groups[].enabledPlugins",
    detect: (c) =>
      Object.values(c.config.groups ?? {}).some((g) => (g?.enabledPlugins?.length ?? 0) > 0),
    emittedBy: ["claude"],
    severity: "warn",
    consequence: "Plugins the org force-enables for the group are enabled nowhere.",
    warrant: "scripts/compile.ts:4348",
  },
  {
    id: "mcp.enforceApproved",
    detect: (c) => c.config.mcp?.enforceApproved === true && (c.config.mcp?.approved?.length ?? 0) > 0,
    emittedBy: ["claude"],
    severity: "error",
    consequence: "Approved-server filtering never executes; mcp-pins.json is a manifest nothing reads.",
    warrant: "scripts/compile.ts:1799",
  },
  {
    id: "ab.modelOverrides",
    detect: (c) => Object.keys(c.config.ab?.modelOverrides ?? {}).length > 0,
    emittedBy: ["claude"],
    severity: "warn",
    consequence: "/ab subagents use built-in model defaults.",
    warrant: "scripts/compile.ts:3471",
  },
  {
    id: "managed.guardrails.disableBypassPermissions",
    detect: (c) => Boolean(c.config.managed?.guardrails?.disableBypassPermissions),
    emittedBy: ["claude"],
    severity: "error",
    consequence: "Developers can still bypass permission prompts.",
    warrant: "scripts/compile.ts:3433",
  },
  {
    id: "compliance.inputScan.scannerCommand",
    detect: (c) => Boolean(c.config.compliance?.inputScan?.scannerCommand),
    emittedBy: ["claude", "codex", "copilot", "plugin"],
    // The plugin tree is assembled FROM dist/claude/; its emitters run only when
    // `claude` is also built. Declared once in PLATFORM_REQUIRES.
    conditionalOn: { plugin: PLATFORM_REQUIRES["plugin"]! },
    severity: "error",
    consequence: 'The DLP scanner is never invoked. Prompts are unscanned, failMode "closed" notwithstanding.',
    warrant: "scripts/compile.ts:2424",
  },
  {
    id: "compliance.outputScan.blocking",
    detect: (c) => c.config.compliance?.outputScan?.blocking === true,
    emittedBy: ["claude", "codex", "copilot", "plugin"],
    // The plugin tree is assembled FROM dist/claude/; its emitters run only when
    // `claude` is also built. Declared once in PLATFORM_REQUIRES.
    conditionalOn: { plugin: PLATFORM_REQUIRES["plugin"]! },
    severity: "error",
    consequence: "Nothing scans or blocks model output.",
    warrant: "scripts/compile.ts:2410",
  },
  /**
   * NF3-9 — the two compliance keys that had no row.
   *
   * The table covered `compliance.inputScan.scannerCommand` and
   * `compliance.outputScan.blocking` and stopped there, so an org configuring an
   * OUTPUT scanner without `blocking: true` — a perfectly ordinary
   * warn-only DLP posture — got no Coverage finding at all on a hub with no
   * hook-capable platform. Same for `inputScan.failMode: "closed"`, which is the
   * key that turns a scanner failure into a refusal: on a cursor-only hub it
   * means nothing, and nothing said so.
   *
   * This is the enumerate-the-config-surface gap that left the group tier
   * invisible (R2-3) and the persona scope invisible (R2-9), one key over each
   * time. The completeness invariant added with CONFIG_SHAPE catches the
   * converse direction (a typed key with no row is now visible); these two are
   * the rows themselves.
   *
   * Severity mirrors the sibling each key modifies: a scanner that never runs is
   * an `error`, a failMode that cannot be honoured is a `warn` because the scan
   * itself is the control and the mode is how strictly it is applied.
   */
  {
    id: "compliance.outputScan.scannerCommand",
    detect: (c) => Boolean(c.config.compliance?.outputScan?.scannerCommand),
    emittedBy: ["claude", "codex", "copilot", "plugin"],
    conditionalOn: { plugin: PLATFORM_REQUIRES["plugin"]! },
    severity: "error",
    consequence:
      "The org's output scanner is never invoked. Model output is unscanned — with or " +
      "without outputScan.blocking, which was the only outputScan key with a row.",
    warrant: "scripts/compile.ts:2410",
  },
  {
    id: "compliance.inputScan.failMode",
    detect: (c) => Boolean(c.config.compliance?.inputScan?.failMode),
    emittedBy: ["claude", "codex", "copilot", "plugin"],
    conditionalOn: { plugin: PLATFORM_REQUIRES["plugin"]! },
    severity: "warn",
    consequence:
      "No hook exists to apply the fail mode to, so `closed` does not make anything fail closed.",
    warrant: "scripts/compile.ts:2424",
  },
  {
    id: "compliance.outputScan.failMode",
    detect: (c) => Boolean(c.config.compliance?.outputScan?.failMode),
    emittedBy: ["claude", "codex", "copilot", "plugin"],
    conditionalOn: { plugin: PLATFORM_REQUIRES["plugin"]! },
    severity: "warn",
    consequence:
      "No hook exists to apply the fail mode to, so `closed` does not make anything fail closed.",
    warrant: "scripts/compile.ts:2410",
  },
  {
    id: "managed.guardrails.denyTools",
    detect: (c) => (c.config.managed?.guardrails?.denyTools?.length ?? 0) > 0,
    emittedBy: ["claude", "codex", "copilot", "plugin"],
    // The plugin tree is assembled FROM dist/claude/; its emitters run only when
    // `claude` is also built. Declared once in PLATFORM_REQUIRES.
    conditionalOn: { plugin: PLATFORM_REQUIRES["plugin"]! },
    severity: "error",
    consequence: "The PreToolUse deny hook is emitted nowhere; denied tools run.",
    warrant: "scripts/compile.ts:2410",
  },
  {
    id: "managed.guardrails.requireAuditLog",
    detect: (c) => Boolean(c.config.managed?.guardrails?.requireAuditLog),
    emittedBy: ["claude", "codex", "copilot", "plugin"],
    // The plugin tree is assembled FROM dist/claude/; its emitters run only when
    // `claude` is also built. Declared once in PLATFORM_REQUIRES.
    conditionalOn: { plugin: PLATFORM_REQUIRES["plugin"]! },
    severity: "error",
    consequence: "The telemetry hook is emitted nowhere; nothing is audit-logged.",
    warrant: "scripts/compile.ts:2410",
  },
  {
    id: "managed.guardrails.forcePlugins",
    // The special case, and the point of the whole table: emittedBy is EMPTY, so
    // the intersection is empty for EVERY configuration and this fires whenever
    // the key is set. It is typed, documented, accepted — and read by no code
    // path in AgentBoot. Do not leave a governance knob wired to nothing.
    detect: (c) => (c.config.managed?.guardrails?.forcePlugins?.length ?? 0) > 0,
    emittedBy: [],
    severity: "error",
    consequence: "This key is accepted, typed and documented, and read by no code path in AgentBoot.",
    warrant: "NOT IMPLEMENTED — scripts/lib/config.ts type + docs/configuration.md only",
  },
  /**
   * R2-9 / NF3-5 — the PERSONA-scope twins.
   *
   * `personas[*].disallowedTools` and `personas[*].hooks` are emitted only
   * inside `if (outputFormats.includes("claude"))` (compile.ts:1174 and the
   * generatePersonaHooks call), and had no row here, so the persona scope was
   * invisible to a gate whose whole job is "configured, but no configured
   * platform can honour it". Same shape as R2-3's group tier, one scope over.
   *
   * Severity `error` for both, matching `claude.hooks` and
   * `claude.permissions.deny`: these are restrictions, and losing a restriction
   * WIDENS what the agent may do. `tools` is the allow-list form of the same
   * thing — a persona restricted to three tools that ships with no restriction
   * gets all of them — so it is an error too, and NOT the
   * `claude.permissions.allow` case, which is a pre-approval convenience whose
   * loss only costs a prompt.
   */
  {
    id: "personas[*].disallowedTools",
    configPath: null, // frontmatter / persona.config.json, not the hub config
    detect: (c) => c.personaControls.disallowedTools > 0,
    emittedBy: ["claude"],
    severity: "error",
    consequence:
      "A persona's tool DENY list is applied on no target — and dist/copilot ships the " +
      "list verbatim into persona.config.json on a platform that cannot enforce it, so " +
      "the restriction reads as delivered while nothing enforces it.",
    warrant: "scripts/compile.ts:1174",
  },
  {
    id: "personas[*].hooks",
    configPath: null, // frontmatter / persona.config.json, not the hub config
    detect: (c) => c.personaControls.hooks > 0,
    emittedBy: ["claude"],
    severity: "error",
    consequence:
      "A persona-declared PreToolUse/PostToolUse gate produces no file. Nothing runs — " +
      "the same loss as claude.hooks, declared one scope down.",
    warrant: "scripts/compile.ts:4795",
  },
  {
    id: "personas[*].tools",
    configPath: null, // frontmatter / persona.config.json, not the hub config
    detect: (c) => c.personaControls.tools > 0,
    emittedBy: ["claude"],
    severity: "error",
    consequence:
      "A persona restricted to an allow-list of tools ships with no restriction, so it " +
      "may use every tool.",
    warrant: "scripts/compile.ts:1180",
  },
  {
    id: "personas[*].mcpServers",
    configPath: null, // frontmatter / persona.config.json, not the hub config
    /**
     * NF3-4: the `managed.guardrails.forcePlugins` shape, in persona scope.
     *
     * Typed (config.ts, "Per-persona MCP servers"), documented, accepted, and
     * copied verbatim into dist/skill/core/<persona>/persona.config.json and
     * dist/copilot/.../persona.config.json — and read by NO code path:
     * `grep -rn '\.mcpServers' scripts/ | grep 'pc\.\|personaConfig\.'` → 0 hits.
     * No .mcp.json entry is written for it anywhere.
     *
     * emittedBy is EMPTY, so the intersection is empty for every configuration
     * and this fires whenever the key is set — which is the point. Whether the
     * resolution is to implement it or to delete it is a product call; leaving a
     * governance knob wired to nothing while saying nothing is not.
     */
    detect: (c) => c.personaControls.mcpServers > 0,
    emittedBy: [],
    severity: "error",
    consequence:
      "This key is accepted, typed, documented and copied into dist, and read by no code " +
      "path in AgentBoot. No MCP server is registered for it on any platform.",
    warrant: "NOT IMPLEMENTED — scripts/lib/config.ts:628 type + copied-through dist only",
  },
  {
    id: "instructions[].applyTo",
    configPath: null, // frontmatter / persona.config.json, not the hub config
    // Fires only on a NARROWING glob. The shipped baseline.instructions.md
    // carries applyTo: "**", which is universal — losing that scope is a no-op,
    // and firing on it would make every default install warn, which is how a
    // check becomes noise inside a week.
    detect: (c) => c.narrowlyScopedInstructions > 0,
    emittedBy: SCOPE_EMITTERS,
    severity: "warn",
    consequence: "Narrowly-scoped instructions ship unscoped.",
    warrant: "scripts/compile.ts:1196",
  },
  {
    id: "gotchas[].paths",
    configPath: null, // frontmatter / persona.config.json, not the hub config
    detect: (c) => c.scopedGotchas > 0,
    emittedBy: SCOPE_EMITTERS,
    severity: "warn",
    consequence: "Path-scoped gotchas ship unscoped.",
    warrant: "scripts/compile.ts:1265",
  },
];

/**
 * The platforms that will ACTUALLY emit this capability for a given build.
 *
 * The single place `conditionalOn` is applied. Every consumer (the build gate,
 * doctor's Coverage block, the reporting label) goes through here, because a
 * second copy of this filter is precisely how `plugin` ended up claimed by four
 * rows and emitted by none.
 *
 * R1-6 — WHERE THIS ACTUALLY BITES, stated so it is not mistaken for
 * defence-in-depth. In the BUILD path it is provably a no-op: H1's
 * `PLATFORM_REQUIRES` gate hard-exits any build where `plugin` is in
 * outputFormats without `claude` (compile.ts, ~line 3595), and the capability
 * gate runs ~500 lines later — so by the time this is consulted, `plugin`
 * implies `claude` and `effectiveEmitters(row, outputFormats) === row.emittedBy`
 * for every row whose only `conditionalOn` key is `plugin`, which is all four
 * that carry one. Deleting every `conditionalOn` block would leave compile-path
 * behaviour identical.
 *
 * It has effect in `doctor`, `capabilityShortfalls` and the evidence surfaces,
 * which read DECLARED formats without the build gate in front of them — i.e.
 * exactly the paths an operator uses to ask "what would happen", and the paths
 * that can be handed a config the build has not accepted. That is why it stays,
 * and why it is not a second line of defence for the build.
 */
export function effectiveEmitters(row: CapabilityRow, outputFormats: readonly string[]): string[] {
  return row.emittedBy.filter((platform) => {
    const deps = row.conditionalOn?.[platform];
    if (!deps) return true;
    return deps.every((d) => outputFormats.includes(d));
  });
}

/** Where a platform's executable hooks live inside dist/, or null when the
 * platform has no hook mechanism at all. */
export function hookDirForPlatform(distPath: string, platform: string): string | null {
  switch (platform) {
    case "claude": return path.join(distPath, "claude", "core", "hooks");
    case "codex": return path.join(distPath, "codex", "core", ".codex", "hooks");
    case "copilot": return path.join(distPath, "copilot", "core", ".github", "hooks");
    case "plugin": return path.join(distPath, "plugin", "hooks");
    default: return null;
  }
}

/**
 * Q73: where a platform's hook scripts are BOUND to events, or null when the
 * platform has no binding artifact.
 *
 * The scripts are the mechanism; the binding is what makes the mechanism run.
 * `dist/plugin/hooks/agentboot-pretooluse.sh` on its own is an inert file — it
 * only ever executes because `hooks.json` names it against `PreToolUse`. Delete
 * the binding and every probe still passes, because the harness executes the
 * script directly and never asks the one question that matters: is anything
 * going to call it?
 *
 * Verified at d9de530 on a `["claude","plugin"]` hub with `denyTools`
 * configured: `rm dist/plugin/hooks/hooks.json` and BOTH honesty surfaces stayed
 * green — `conformance` printed four `✓ pass` rows for plugin under
 * "✓ All 8 probed control(s) behave as declared" and exited 0, and `doctor`
 * printed "✓ plugin: org policy is enforceable" and exited 0. The enforcement
 * had been removed and the product reported it was in force.
 *
 * Every hook-bearing platform emits its binding unconditionally when the
 * platform is built (checked against a hub with no `managed`/`compliance` block
 * at all), so an absent binding is always a defect and never a legitimate
 * configuration.
 */
export function hookBindingForPlatform(distPath: string, platform: string): string | null {
  switch (platform) {
    case "claude": return path.join(distPath, "claude", "core", "settings.json");
    case "codex": return path.join(distPath, "codex", "core", ".codex", "hooks.json");
    case "copilot": return path.join(distPath, "copilot", "core", ".github", "hooks", "agentboot.json");
    case "plugin": return path.join(distPath, "plugin", "hooks", "hooks.json");
    default: return null;
  }
}

export type HookBinding =
  /** The platform has no binding artifact — advisory targets, and anything new. */
  | { state: "none" }
  /** No dist/<platform>/ tree at all: this platform was not built. Distinct from
   *  a built tree with the binding removed, because the remedies differ. */
  | { state: "not-built"; file: string }
  | { state: "missing"; file: string }
  | { state: "unreadable"; file: string; detail: string }
  | { state: "present"; file: string; boundScripts: string[] };

/**
 * Read a platform's hook binding and extract the script filenames it references.
 *
 * The extraction is deliberately shape-agnostic: it walks every string in the
 * document and collects `agentboot-*.sh` basenames. The four emitters produce
 * four different JSON shapes (Claude settings `hooks`, Codex `hooks.json`,
 * Copilot `agentboot.json`, plugin `hooks.json`), and re-implementing each shape
 * here would create a second copy of the emitter that drifts silently — exactly
 * the two-lists-that-must-agree failure this module keeps correcting. A binding
 * that names the script is what we can honestly assert; how it names it is the
 * emitter's business.
 */
export function readHookBinding(distPath: string, platform: string): HookBinding {
  const file = hookBindingForPlatform(distPath, platform);
  if (!file) return { state: "none" };
  if (!fs.existsSync(path.join(distPath, platform))) return { state: "not-built", file };
  if (!fs.existsSync(file)) return { state: "missing", file };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    return { state: "unreadable", file, detail: e instanceof Error ? e.message : String(e) };
  }
  const bound = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      for (const m of node.matchAll(/agentboot-[A-Za-z0-9._-]+\.sh/g)) bound.add(m[0]!);
      return;
    }
    if (Array.isArray(node)) { for (const v of node) walk(v); return; }
    if (node && typeof node === "object") { for (const v of Object.values(node)) walk(v); }
  };
  walk(parsed);
  return { state: "present", file, boundScripts: [...bound].sort() };
}

/** Does this binding actually wire `scriptName` to an event? */
export function isScriptBound(binding: HookBinding, scriptName: string): boolean {
  return binding.state === "present" && binding.boundScripts.includes(scriptName);
}

// ---------------------------------------------------------------------------
// Probe runner
// ---------------------------------------------------------------------------

/**
 * Every bash this machine might have, in precedence order — derived ENTIRELY
 * from the environment.
 *
 * The Windows leg was the single literal `C:\Program Files\Git\bin\bash.exe`,
 * which is wrong in two directions:
 *
 *  - **False untested.** Git for Windows installed anywhere else was invisible:
 *    the per-user (non-admin) installer defaults to
 *    `%LOCALAPPDATA%\Programs\Git`, the 32-bit build lands under
 *    `%ProgramFiles(x86)%`, and a `D:`-drive install is ordinary. Those
 *    operators were told their hooks were UNTESTED while a perfectly good bash
 *    sat on disk — the harness under-reporting its own reach.
 *  - **Unfalsifiable.** A hardcoded absolute path means NO environment can
 *    express "this machine has no bash", so the honesty gate that fires on an
 *    untested run could not be exercised on Windows at all. The negative tests
 *    that assert "a run which measured nothing prints no green claim" therefore
 *    could not be made to fail there — and a gate nobody can make fire is
 *    indistinguishable from a gate that does not work. That is this product's
 *    own green-surface-over-nothing class, sitting in the probe.
 *
 * `AGENTBOOT_BASH`, when set, is the ONLY candidate. An operator who names a
 * bash and silently gets a different one has been handed exactly the
 * substitution this command exists to detect; if the named one does not run,
 * the honest answer is "untested", not "here is another one".
 *
 * `platform`/`env` are parameters so the Windows candidate set is assertable
 * from any host — the resolver is the thing most likely to drift, and it is not
 * testable on the platform it matters on.
 */
export function bashCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const explicit = env["AGENTBOOT_BASH"]?.trim();
  if (explicit) return [explicit];

  const out = ["bash"];
  if (platform === "win32") {
    const roots = [
      env["ProgramFiles"],
      env["ProgramW6432"],
      env["ProgramFiles(x86)"],
      env["LOCALAPPDATA"] ? path.join(env["LOCALAPPDATA"], "Programs") : undefined,
    ];
    for (const root of roots) {
      if (!root) continue;
      out.push(path.join(root, "Git", "bin", "bash.exe"));
    }
  }
  return [...new Set(out)];
}

/** Locate a bash usable for executing hook scripts (Git Bash on Windows). */
export function probeBash(): string | null {
  for (const candidate of bashCandidates()) {
    try {
      const r = spawnSync(candidate, ["--version"], { stdio: "pipe", timeout: PROBE_TIMEOUT_MS });
      if (r.status === 0) return candidate;
    } catch { /* try next */ }
  }
  return null;
}

export interface ProbeResult {
  probe: string;
  expected: string;
  observed: string;
  pass: boolean;
}

interface HookRun {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Execute a hook script with sandboxed side effects (HOME + telemetry log
 * redirected into a temp dir) and a hard timeout. */
function runHook(bashPath: string, scriptPath: string, stdin: string, timeoutMs: number, sandbox: string): HookRun {
  const r = spawnSync(bashPath, [scriptPath], {
    input: stdin,
    encoding: "utf-8",
    stdio: "pipe",
    timeout: timeoutMs,
    env: {
      ...process.env,
      HOME: sandbox,
      USERPROFILE: sandbox,
      AGENTBOOT_TELEMETRY_LOG: path.join(sandbox, "telemetry.ndjson"),
    },
  });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut };
}

const describeRun = (run: HookRun): string =>
  run.timedOut ? "TIMED OUT" : `exit ${run.status}${run.stdout.includes('"decision":"block"') ? " (block decision)" : ""}`;

/** Secret canary, concatenation-assembled so scanners in CI never see it whole. */
const secretCanary = (): string => ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");

// ---------------------------------------------------------------------------
// Per-control probe suites
// ---------------------------------------------------------------------------

export interface ControlResult {
  control: string;
  mechanism: string;
  declared_level: PlatformEnforcement["level"];
  /** pass: all probes matched expectations. fail: at least one mismatch.
   * untested: mechanism exists but could not be probed (reason says why).
   * not-applicable: the platform has no mechanism for this control. */
  status: "pass" | "fail" | "untested" | "not-applicable";
  reason?: string;
  probes: ProbeResult[];
}

function probeInputScan(bashPath: string, script: string, sandbox: string): ProbeResult[] {
  const probes: ProbeResult[] = [];
  const timeoutMs = 5000; // matches the compiled hook binding

  const clean = runHook(bashPath, script, JSON.stringify({ prompt: "refactor the parser module" }), timeoutMs, sandbox);
  probes.push({ probe: "clean input passes", expected: "exit 0", observed: describeRun(clean), pass: clean.status === 0 });

  const secret = runHook(bashPath, script, JSON.stringify({ prompt: `use key ${secretCanary()}` }), timeoutMs, sandbox);
  probes.push({
    probe: "secret-bearing input BLOCKS",
    expected: "exit 2 (block decision)",
    observed: describeRun(secret),
    pass: secret.status === 2 && secret.stdout.includes('"decision":"block"'),
  });

  const malformed = runHook(bashPath, script, "this is not json", timeoutMs, sandbox);
  probes.push({
    probe: "malformed input fails CLOSED",
    expected: "exit 0 with empty extraction OR exit 2 block — never a crash past the parse guard",
    observed: describeRun(malformed),
    pass: malformed.status === 0 || malformed.status === 2,
  });

  const oversized = runHook(bashPath, script, JSON.stringify({ prompt: "x".repeat(500_000) }), timeoutMs, sandbox);
  probes.push({
    probe: "oversized input completes within the 5s hook binding",
    expected: "completes (no timeout)",
    observed: describeRun(oversized),
    pass: !oversized.timedOut,
  });

  return probes;
}

function probeOutputScan(bashPath: string, script: string, sandbox: string, failMode: "open" | "closed"): ProbeResult[] {
  const probes: ProbeResult[] = [];
  const timeoutMs = 5000;

  // Probe with the REAL Stop payload shape: the platform delivers the final
  // text as `last_assistant_message`. (The pre-0.16 harness probed a phantom
  // `response` field the platform never sends — matching the pre-0.16 hook's
  // identical bug, so a scan that read nothing tested green. Probes must
  // mirror the platform contract, not the implementation under test.)
  const clean = runHook(bashPath, script, JSON.stringify({ hook_event_name: "Stop", last_assistant_message: "here is the refactored parser" }), timeoutMs, sandbox);
  probes.push({ probe: "clean output passes", expected: "exit 0", observed: describeRun(clean), pass: clean.status === 0 });

  const secret = runHook(bashPath, script, JSON.stringify({ hook_event_name: "Stop", last_assistant_message: `creds: ${secretCanary()}` }), timeoutMs, sandbox);
  if (failMode === "closed") {
    probes.push({
      probe: "secret in output BLOCKS (outputScan.blocking enabled)",
      expected: "exit 2",
      observed: describeRun(secret),
      pass: secret.status === 2,
    });
  } else {
    probes.push({
      probe: "secret in output WARNS (outputScan.blocking disabled — warn-only by design)",
      expected: "exit 0 + warning on stderr",
      observed: `${describeRun(secret)}${secret.stderr.includes("WARNING") ? " (warned)" : " (no warning)"}`,
      pass: secret.status === 0 && secret.stderr.includes("WARNING"),
    });
  }

  // Older platform versions omit last_assistant_message — the hook must fall
  // back to extracting the last assistant message from the JSONL transcript.
  const transcriptPath = path.join(sandbox, "conformance-transcript.jsonl");
  fs.writeFileSync(transcriptPath, [
    JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `creds: ${secretCanary()}` }] } }),
  ].join("\n") + "\n");
  const viaTranscript = runHook(bashPath, script, JSON.stringify({ hook_event_name: "Stop", transcript_path: transcriptPath }), timeoutMs, sandbox);
  probes.push({
    probe: "secret detected via transcript_path fallback (no inline message field)",
    expected: failMode === "closed" ? "exit 2" : "exit 0 + warning on stderr",
    observed: describeRun(viaTranscript),
    pass: failMode === "closed"
      ? viaTranscript.status === 2
      : viaTranscript.status === 0 && viaTranscript.stderr.includes("WARNING"),
  });

  const malformed = runHook(bashPath, script, "not json", timeoutMs, sandbox);
  probes.push({
    probe: "malformed input at Stop fails OPEN (never wedges the session)",
    expected: "exit 0",
    observed: describeRun(malformed),
    pass: malformed.status === 0,
  });

  return probes;
}

function probeTelemetry(bashPath: string, script: string, sandbox: string): ProbeResult[] {
  const run = runHook(bashPath, script,
    JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Edit" }), 3000, sandbox);
  const logWritten = fs.existsSync(path.join(sandbox, "telemetry.ndjson"));
  return [{
    probe: "telemetry event records without blocking",
    expected: "exit 0 within the 3s binding, event appended to the log",
    observed: `${describeRun(run)}${logWritten ? " (log written)" : " (no log)"}`,
    pass: run.status === 0 && !run.timedOut && logWritten,
  }];
}

function probeDenyTools(bashPath: string, script: string, sandbox: string, deniedPattern: string): ProbeResult[] {
  const probes: ProbeResult[] = [];
  // Use a concrete tool name that matches the first configured pattern; glob
  // patterns probe with the glob turned into a literal-ish candidate.
  const deniedTool = deniedPattern.replace(/\*/g, "X").replace(/\?/g, "Y");

  const denied = runHook(bashPath, script, JSON.stringify({ tool_name: deniedTool }), 5000, sandbox);
  probes.push({
    probe: `deny-listed tool "${deniedTool}" BLOCKS`,
    expected: "exit 2 (block decision)",
    observed: describeRun(denied),
    pass: denied.status === 2 && denied.stdout.includes('"decision":"block"'),
  });

  const allowed = runHook(bashPath, script, JSON.stringify({ tool_name: "agentboot-conformance-allowed-tool" }), 5000, sandbox);
  probes.push({
    probe: "non-listed tool passes",
    expected: "exit 0",
    observed: describeRun(allowed),
    pass: allowed.status === 0,
  });

  const malformed = runHook(bashPath, script, "not json", 5000, sandbox);
  probes.push({
    probe: "malformed input fails CLOSED (blocks)",
    expected: "exit 0 with empty tool OR exit 2 — parse guard must hold",
    observed: describeRun(malformed),
    pass: malformed.status === 0 || malformed.status === 2,
  });

  return probes;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

export interface EnforcementManifest {
  platform: string;
  agentboot_version: string;
  generated_at: string;
  /**
   * R1-H: the RESOLVED enforcement for this platform in THIS hub's
   * configuration, not the raw table row. `unmetRequires` travels with it, so a
   * consumer reading `level: "advisory"` can see WHY it is not `enforced`.
   */
  declared: EnforcementResolution;
  controls: ControlResult[];
}

const statusOf = (probes: ProbeResult[]): "pass" | "fail" =>
  probes.every((p) => p.pass) ? "pass" : "fail";

/**
 * Run the conformance harness for one platform against its compiled dist tree.
 */
export function runPlatformConformance(
  distPath: string,
  platform: string,
  config: AgentBootConfig,
  agentbootVersion: string,
  bashPath: string | null,
): EnforcementManifest {
  // R1-H: RESOLVED, not raw. `PLATFORM_ENFORCEMENT.plugin` says `enforced`
  // unconditionally, but plugin's enforcement is conditional on `claude` being
  // built — that is what `requires` means and what `resolveEnforcement` applies.
  // Stamping the raw row into dist/<platform>/enforcement-manifest.json wrote an
  // unconditional claim into the artifact `baseline` archives and
  // `evidence-pack` signs. doctor and guardrail-scan both resolve; these were
  // the leftovers of the same `plugin` class this branch has now fixed three
  // times.
  const declared = resolveEnforcement(platform, configuredPlatforms(config));
  const controls: ControlResult[] = [];
  const hookDir = hookDirForPlatform(distPath, platform);
  // Output-match blocking is governed by compliance.outputScan.blocking
  // (failMode only governs scanner-failure behavior — see compile.ts B2/B3).
  const failMode: "open" | "closed" = config.compliance?.outputScan?.blocking === true ? "closed" : "open";
  const denyTools = config.managed?.guardrails?.denyTools ?? [];

  // Q73: read once per platform — the binding is a property of the tree, not of
  // the individual control.
  const binding = readHookBinding(distPath, platform);

  const hookControl = (
    control: string,
    scriptName: string,
    probe: (bash: string, script: string, sandbox: string) => ProbeResult[],
  ): ControlResult => {
    const base = { control, mechanism: "hook script", declared_level: declared.level };
    if (!hookDir) {
      return { ...base, mechanism: "none", status: "not-applicable", probes: [],
        reason: "no hook mechanism exists on this platform — instructions are advisory only" };
    }
    const script = path.join(hookDir, scriptName);
    if (!fs.existsSync(script)) {
      return { ...base, status: "untested", probes: [],
        reason: `${scriptName} not present in dist — run agentboot build first` };
    }
    // Q73: an UNBOUND script is not a weaker control, it is an absent one — and
    // it is a determination, not a measurement gap, so it is `fail` and not
    // `untested`. This runs BEFORE the bash check on purpose: whether anything
    // will ever invoke the script does not depend on this machine having a bash
    // to invoke it with.
    const bindingFile = hookBindingForPlatform(distPath, platform);
    const bindingFailure = (observed: string, reason: string): ControlResult => ({
      ...base,
      status: "fail",
      probes: [{
        probe: "hook-binding",
        expected: `${scriptName} bound to an event by ${bindingFile ? path.basename(bindingFile) : "the platform binding"}`,
        observed,
        pass: false,
      }],
      reason,
    });
    if (binding.state === "missing") {
      return bindingFailure(
        `${binding.file} is ABSENT`,
        `the hook binding is missing from dist — ${scriptName} is on disk but wired to no event, ` +
        `so it never executes and this control is not enforced. Run \`agentboot build\`.`,
      );
    }
    if (binding.state === "unreadable") {
      return bindingFailure(
        `${binding.file} is not parseable JSON (${binding.detail})`,
        `the hook binding cannot be read, so no hook is registered and this control is not enforced`,
      );
    }
    if (binding.state === "present" && !isScriptBound(binding, scriptName)) {
      return bindingFailure(
        `${path.basename(binding.file)} binds ${binding.boundScripts.length > 0 ? binding.boundScripts.join(", ") : "nothing"}`,
        `${scriptName} is present in dist but no event binds it, so it never executes`,
      );
    }
    if (!bashPath) {
      return { ...base, status: "untested", probes: [],
        reason: "bash not available on this machine — hook behavior not executed" };
    }
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-conformance-"));
    try {
      const probes = probe(bashPath, script, sandbox);
      return { ...base, status: statusOf(probes), probes };
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  };

  controls.push(hookControl("input-scan", "agentboot-input-scan.sh", probeInputScan));
  controls.push(hookControl("output-scan", "agentboot-output-scan.sh",
    (b, s, sb) => probeOutputScan(b, s, sb, failMode)));
  controls.push(hookControl("telemetry", "agentboot-telemetry.sh", probeTelemetry));

  if (denyTools.length > 0) {
    controls.push(hookControl("deny-tools", "agentboot-pretooluse.sh",
      (b, s, sb) => probeDenyTools(b, s, sb, denyTools[0]!)));
  } else {
    controls.push({
      control: "deny-tools", mechanism: hookDir ? "hook script" : "none",
      declared_level: declared.level, status: "not-applicable", probes: [],
      reason: "managed.guardrails.denyTools not configured",
    });
  }

  return {
    platform,
    agentboot_version: agentbootVersion,
    generated_at: new Date().toISOString(),
    declared,
    controls,
  };
}

export interface ConformanceRun {
  manifests: EnforcementManifest[];
  /**
   * Path of the manifest ACTUALLY written, per platform. A platform absent from
   * this map had no dist/ tree, so no manifest exists — the report must not name
   * a file the run did not produce.
   */
  manifestPaths: Record<string, string>;
  /** Platforms whose manifest contains at least one FAILED control. */
  failedPlatforms: string[];
  /**
   * Platforms carrying at least one control that declares a mechanism but could
   * NOT be probed (no bash, script absent from dist/). Separate from
   * `failedPlatforms` because the remedy differs — but equally non-green.
   */
  untestedPlatforms: string[];
  /** Controls that actually executed a probe. Zero means nothing was measured. */
  probedControls: number;
  bashAvailable: boolean;
}

/** A control that declares a mechanism and could not be exercised. */
export const isUntested = (c: ControlResult): boolean => c.status === "untested";

/**
 * Run the harness for every requested platform and write each
 * `dist/<platform>/enforcement-manifest.json`.
 */
export function runConformance(
  distPath: string,
  platforms: string[],
  config: AgentBootConfig,
  agentbootVersion: string,
): ConformanceRun {
  const bashPath = probeBash();
  const manifests: EnforcementManifest[] = [];
  const failedPlatforms: string[] = [];
  const untestedPlatforms: string[] = [];
  /** Written manifests only, keyed by platform. Absent means nothing was written. */
  const manifestPaths: Record<string, string> = {};
  let probedControls = 0;

  for (const platform of platforms) {
    const manifest = runPlatformConformance(distPath, platform, config, agentbootVersion, bashPath);
    manifests.push(manifest);
    if (manifest.controls.some((c) => c.status === "fail")) {
      failedPlatforms.push(platform);
    }
    if (manifest.controls.some(isUntested)) {
      untestedPlatforms.push(platform);
    }
    probedControls += manifest.controls.filter((c) => c.status === "pass" || c.status === "fail").length;
    // Report the path only when the file was actually written. The CLI used to
    // print `manifest: dist/<platform>/enforcement-manifest.json` unconditionally
    // while this write was guarded by `fs.existsSync(platformDir)` with no else
    // branch — so with the platform trees deleted, conformance named two files
    // that did not exist. 1feb969 fixed the exit code (untested is no longer a
    // pass) and left the phantom path in the report.
    const platformDir = path.join(distPath, platform);
    if (fs.existsSync(platformDir)) {
      const manifestPath = path.join(platformDir, "enforcement-manifest.json");
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
      manifestPaths[platform] = path.relative(path.dirname(distPath), manifestPath);
    }
  }

  return {
    manifests,
    failedPlatforms,
    untestedPlatforms,
    probedControls,
    manifestPaths,
    bashAvailable: bashPath !== null,
  };
}
