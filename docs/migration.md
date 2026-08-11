---
sidebar_label: "Migration Guide"
sidebar_position: 3
---

# Migration Guide

Upgrade instructions for each AgentBoot release that requires action. Releases not
listed here are backward-compatible and require only a package update.

---

## v0.20 → v1.0 (1.0.0)

**Read this section before upgrading a hub that builds in CI.** 1.0.0 is the release
where a long list of *silent losses* became *refusals*. Nothing about your hub source
is invalid, but configuration that previously compiled to nothing — while `build`,
`validate --strict` and `doctor` all reported green — now fails the build and names
what it cannot honour. Expect a red build on the first run, and expect the red build
to be telling you about enforcement you thought you already had.

```bash
npm install -g agentboot@latest
cd /path/to/your-personas-hub
agentboot build            # read the failures; they are findings, not noise
agentboot doctor           # new Coverage section, printed before Enforcement
agentboot sync --dry-run   # review deletions before they propagate
```

### The one to read first: path scope was inverted, not dropped

An instruction authored `applyTo: "src/api/**"` was delivered to Cursor, Windsurf and
JetBrains as **always-on, every file** — the compiler stripped the source frontmatter
without parsing it and hardcoded `alwaysApply: true`. Exit 0, no diagnostic. Your
narrowly-scoped rules have been firing everywhere.

**Action:** after upgrading, your scoped rules start behaving as authored. If any
downstream behaviour depended on the accidental always-on delivery, it changes here.
Related: a malformed `applyTo:`/`paths:` used to read as "no scope" (i.e. always-on)
and now **stops the build** — fix the YAML, or write `applyTo: "**"` if the rule
really is universal.

### New build-FAILING gates you can reach from an existing config

- **A configured capability that no configured platform can emit.** Eight of them were
  found producing zero bytes on a real hub — an org `PreToolUse` gate, a fail-closed
  DLP scanner, a digest-pinned MCP allowlist, `disableBypassPermissionsMode`, model
  overrides. **Action:** add the platform that can honour the capability, drop the
  key, or waive it with a `capability:<id>` entry in `agentboot-exceptions.json`
  (owner + approver required, and it expires — a waived gap still prints on every
  build).
- **A narrowly-scoped instruction aimed at a platform that cannot express scope**
  (`claude`, `skill`, `plugin`, `agents`, `codex`, `gemini`). Acknowledge it on the
  artifact with `scope-unsupported: acknowledged`; the emitted file then carries a
  `Scope:` preamble naming the intended paths, so you are opting into a documented
  degraded delivery rather than into silence.
- **A differing-value collision in the managed-scope merge.** Declare intended
  overrides in `managed.scopeMerge.acknowledgedOverrides`; the loss is then a warning
  naming winner, loser and both sources, because an acknowledged loss is still a loss.
- **`managed.guardrails.forcePlugins`** was typed, documented, accepted — and read by
  no code path on any platform. Setting it now fails the build. Same posture for
  `personas[*].mcpServers`.
- **An unreadable `persona.config.json` or managed-settings fragment** is fatal rather
  than a yellow warning followed by a persona shipping without its tool restrictions.
- **A gotcha `paths:` value that escapes the output root** fails the build. It was an
  arbitrary file write from an artifact source, on `agentboot build`.

### Revocation now works — the first sync after upgrading may DELETE

`dist/` was never pruned and `sync` never unlinked anything, so an artifact you
removed from `instructions.enabled` — or an entire platform you removed from
`personas.outputFormats` — kept shipping to every spoke indefinitely, with `build`,
`sync`, `status`, `drift-check` and `audit` all green and the manifest attesting the
delivered bytes as correct.

**Action, and please do this one deliberately:**

1. Run `agentboot sync --dry-run` **first**. Any stale artifact accumulated before
   this release is removed in one pass.
2. Deletion is confined to paths listed in the spoke's previous manifest, so sync can
   only remove files it wrote.
3. A revoked artifact the spoke has **edited** is an error, not a silent skip: it is
   recorded in the manifest's new `retired[]` array, `sync` exits non-zero, and
   `drift-check` reports it. A `retain` regex on the `repos.json` entry (or hub-wide
   `sync.retain`) downgrades it to a warning that still prints every sync.
4. Because several platforms share a `targetDir`, revocation propagation is skipped —
   loudly — for one run against an untagged manifest.

`manifest_digest` changes for **every** spoke (manifests gained `platform` and
`retired[]`), so the first sync reports every repo as changed and signed hubs re-sign.

### Other behaviour changes

- **`sync` refuses to ship a platform the hub does not build.** `repos.json` and
  `personas.outputFormats` could contradict each other, and the contradiction was
  resolved silently in favour of the stale tree — i.e. in favour of the retired
  policy. Other repos still sync; the run exits non-zero at the end.
- **`test`, `baseline`, `drift-check`, `conformance`, `install-user`, `publish` and
  `connect` refuse to act on a `dist/` whose own build stamp says `failed`.** In
  particular `agentboot test --snapshot` no longer banks a superseded tree as the
  baseline every later `--regression` is compared against.
- **Blocking hooks no longer fail open** on a payload they cannot read, measure or
  parse. Three routes each turned the DLP input scan and the PreToolUse deny gate into
  exit 0 with nothing on stdout or stderr. The Stop-hook output scan still exits 0 by
  design — a Stop hook that blocks strands the session — but now says
  `output scan SKIPPED, this response was NOT scanned`.
- **`mcp.enforceApproved: true` with an empty `mcp.approved` list now enforces.** The
  maximum-shortfall state — nothing approved — was the one state that produced no
  finding and shipped every configured server.
- **Persona-declared hooks are scanned for dangerous shell patterns.** A persona hook
  piping a network download into a shell used to build green.
- **`drift-check` reports an unreadable manifest** as `UNCHECKED` / `PARTIALLY
  CHECKED` rather than as `clean`.
- **`audit` staleness compares the artifact-source digest**, not file mtimes, so an
  edit with a rewound mtime and a deleted artifact are both caught.
- **`output.failOnDirtyDist` is deprecated and ignored** (it warns when set). Staging
  builds make a dirty `dist/` structurally impossible.
- **`agentboot test --behavioral --allow-unevaluated` waives judgement-only scenarios
  again.** Structurally broken scenarios remain unwaivable, as does "no cases ran".

### New commands

- **`agentboot baseline`** — archive a dated conformance snapshot. Platforms change
  their enforcement semantics silently and your corpus text does not move, so
  `drift-check` stays green while governance stops working. A baseline cannot be
  backfilled. **Action:** start running it on a schedule now, not when you need it.
- **`agentboot identity`** — stamp permanent ids and content hashes on governed
  artifacts. Also cannot be applied retroactively; run it once before your 1.0 cut so
  your artifacts date from then rather than from whenever you get to it.

Both are documented in the [CLI reference](./cli-reference.md).

---

## v0.19 → v0.20 (0.20.0 through 0.20.2)

Assurance hardening from a GA-readiness audit — every verifier AgentBoot ships now
fails **closed** on tampered, stripped or unbound input — followed by fixes from a
beta evaluation that ran the product end to end from the published documentation only.
Hub **source** does not need rewriting.

```bash
npm install -g agentboot@latest
cd /path/to/your-personas-hub
agentboot build
agentboot sync
```

### Behavior changes in 0.20.0

- **Verifiers fail closed.** `telemetry-verify` cryptographically verifies batch
  signatures and enforces them under `--require-signed` (stripping every signature
  previously *passed*); signing is all-or-nothing, so a signing failure aborts the
  spool and leaves the cursor unmoved instead of shipping unsigned.
  `verify-manifest` no longer reports a signed posture on content failing its digest
  or file-hash check, and an attestation that cannot be bound to a manifest no longer
  passes. `mcp-verify` is fail-closed on the `--pins` CI path. **Action:** a CI job
  that was green on stripped or unbindable evidence turns red — that red is the true
  state, and it is the point of the release.
- **`--config` / `AGENTBOOT_HUB` is now honored by `test`, `conformance`,
  `install-user`, `optimize` and `add`.** **Action:** scripts that passed `--config`
  to these and relied on the buggy cwd fallback now get the hub they asked for.
- **Releases fire only on a strict semver increase**, and the version-string guard
  catches stale `agentboot@` pins of any minor.
- **The secret scan covers `agentboot.config.json`** and flags literal telemetry-sink
  header values; sink and pin config files classify as enforcement-risk in sync PR
  summaries. **Action:** a hub with an inline sink token gets a new finding.
- **Added:** `agentboot evidence-pack` includes MCP governance (approved servers,
  registry provenance, pin status) and an explicit `integrity.signed` field.

### Behavior changes in 0.20.2

Reporting honesty — most controls worked, but described what they had done
inaccurately.

- **`sync` PR mode asserts its preconditions before mutating the repo.** Previously
  the first sign PR mode could not be honoured was a `git push` or `gh` failure —
  after a branch had been cut and a commit made. The error now names the cause and
  states plainly that files were written directly, so nobody is left believing a
  review gate applied when it did not. `sync --dry-run` also reports that PR mode is
  active; its output used to be byte-identical to direct-write.
- **`import` can now clear the gate that recommends it.** The first sync onto a repo
  with existing instruction files stops and points at `import` — but `import` never
  modifies the source repo, so the gate re-fired identically and the destructive
  `--adopt-existing` branch was the only escape. Import now records what it imported,
  and the gate reads that record.
- **`drift-check` counts deletions** (a deletion-only drift printed `0 modified`) and
  **`--verbose` works** — it was accepted and silently ignored.
- **Shadowing a `guardrail: hard` artifact fails `validate --strict`.** The check
  covered only trait weights set to `OFF`, so re-declaring the artifact at a lower
  scope with `guardrail: soft` passed. **Action:** hubs using scope overrides may
  meet a new strict-mode failure.
- **Provenance headers, build output and secret-scan findings resolve against the
  hub** rather than the installed package directory, which had been leaking the
  operator's filesystem layout into every file synced to every spoke.
- **Added:** `agentboot add instruction <name>`, and
  [`docs/guardrails.md`](https://agentboot.dev/docs/guardrails) — the authoring syntax
  for `guardrail: hard` previously appeared on no documentation surface at all.

---

## v0.15 → v0.19 (0.16.0 through 0.19.0)

The GA-hardening series: an adversarial audit of AgentBoot's own enforcement claims
(0.16.0), tamper-evident telemetry (0.17.0), the auditor-facing evidence surface and
AGENTS.md promotion (0.18.0), and MCP digest pinning plus optional in-toto
attestation (0.19.0). Hub **source** does not need rewriting. The standard path
applies: update the package, rebuild, resync — then read the per-release notes
below, because several fixes change what the first post-upgrade build and sync do.

```bash
npm install -g agentboot@latest
cd /path/to/your-personas-hub
agentboot build
agentboot sync
```

### Behavior changes in 0.16.0

- **The output-scan Stop hook now actually blocks.** It previously read a payload
  field the platform never sends (`response`) and scanned the empty string on every
  invocation — a documented-as-blocking no-op. It now reads the real field
  (`last_assistant_message`, with a transcript fallback) and its binding is
  synchronous. **Action:** rebuild + resync, then expect Stop-hook blocks that never
  fired before; if `outputScan.blocking` is set, budget for triage.
- **Sibling-scope content no longer leaks to every spoke.** The parent-scope sync
  walk previously shipped every *other* team's content to every repo in a group.
  **Action:** the first post-upgrade sync PR may *remove* content from spokes —
  that content should never have been there; review with that in mind.
- **The published telemetry JSON Schema is now generated from the canonical event
  spec** (`additionalProperties: false`) — the old artifact rejected the product's
  own `session_summary` events and permitted fields the hooks never emit.
  **Action:** tooling that validates events against the shipped schema must adopt
  the regenerated artifact.
- **The secret scan now covers the full compiler input surface** (core,
  instructions, gotchas, lexicon, all scope layouts, domains; `.yaml` included).
  **Action:** hub content that previously passed `validate` may now fail; scrub or
  use placeholders.
- **`sync --adopt-existing` archives more root files.** `AGENTS.md`, `.cursorrules`,
  and `GEMINI.md` are now archived to `.agentboot-archive/` before overwrite instead
  of being destroyed. **Action:** none — strictly safer.
- **`verify-manifest` gained tamper-protection flags**: `--require-signed` makes a
  missing signature a failure (the defense against signature stripping) and
  `--allowed-signers`/`--signer` authenticate signer identity. **Action:** spoke CI
  that runs `verify-manifest` should adopt `--require-signed` once signing is on.
- **Node.js floor is 22** (`doctor` now agrees with `engines`). **Action:** upgrade
  runtimes below Node 22.

### Behavior changes in 0.17.0

- **Telemetry event schema v1 → v2.** Every event now carries a `chain` field
  (sha256 hash chain computed at append time), and the published schema artifact is
  now **`dist/schema/telemetry-event.v2.json`**. **Action:** tooling pinned to the
  v1 schema path or schema must move to v2 and tolerate the `chain` field.
- **New commands `telemetry-ship` / `telemetry-verify`** ship digest-chained,
  optionally SSH-signed batches to an org-configured collector and verify
  log/batch integrity. **Opt-in:** nothing ships unless you set `telemetry.sink`
  in the hub config — there is no default endpoint.
- **`telemetry.sink` compiles into `telemetry-sink.json` in every platform core dir
  and syncs to spokes.** **Action:** if you enable a sink, the next sync delivers a
  new visible artifact to every repo; shipped events are no longer
  developer-deletable — disclose this to your developers (see
  [privacy.md](privacy.md)).

### Behavior changes in 0.18.0

- **AGENTS.md is now an officially supported, first-class output** (previously
  community tier; enforcement class is ADVISORY — instructions, not hooks). The
  compile fallback output set now includes `agents`. **Action:** hubs building
  without an explicit `personas.outputFormats` list may emit — and the next sync
  may deliver — an `AGENTS.md` spokes didn't previously receive; repos with a
  hand-written `AGENTS.md` hit the first-sync stop / `--adopt-existing` flow.
- **New command `evidence-pack`** exports a signed, digest-protected bundle of the
  org's governance state for auditors. Opt-in; no migration required.
- Docs and website truth-up only otherwise — no other user-facing changes.

### Behavior changes in 0.19.0

- **MCP digest pinning.** `agentboot mcp-pin --write` records a sha256 pin over each
  approved server's live tool definitions (`mcp.approved[].toolsDigest`, per-tool
  hashes in an `agentboot.mcp-pins.json` sidecar); `agentboot mcp-verify` re-checks
  them for rug-pulls. Pins compile into **`mcp-pins.json` in every platform core
  dir**, so spokes can verify without the hub (`mcp-verify --pins
  .claude/mcp-pins.json`). **Action:** a new synced artifact appears in spokes;
  `validate` now warns on approved servers that are unpinned or lack the new
  `mcp.approved[].registry` provenance field — pin your servers or expect warnings.
- **Optional in-toto/DSSE attestation.** With `sync.signing.emitInToto` set, signed
  syncs emit `.agentboot-manifest.intoto.json` and `verify-manifest` verifies it.
  Opt-in; no action unless enabled (then expect the new artifact in sync PRs).
- **AGENTS.md import discovery, root and nested.** `import` now auto-discovers
  nested `AGENTS.md` files (the spec's monorepo pattern). **Action:** re-running an
  import sweep may surface files earlier sweeps missed.
- **Fixed:** `--config` was silently ignored by `telemetry-inspect`,
  `telemetry-ship`, and `evidence-pack` (they fell back to cwd discovery).
  **Action:** scripts that passed `--config` to these commands and relied on the
  buggy cwd fallback now get the config they asked for.

---

## v0.11 → v0.15 (0.12.0 through 0.15.0)

These four releases shipped together as an enterprise-hardening series. Your hub
**source** (traits, personas, gotchas, config) does not need to be rewritten, but
several **behaviors changed** — this is not a drop-in upgrade if you have automation
or tooling built against the old behaviors. Read the list below, then follow the
standard path: update the package, re-run `agentboot install` in the hub, rebuild,
and resync.

```bash
npm install -g agentboot@latest
cd /path/to/your-personas-hub
agentboot install
agentboot build
agentboot sync
```

Expect the first post-upgrade sync to be **larger than usual** — the manifest format
changed and scope-layout fixes may deliver content that previously compiled to
nothing (see below).

### Behavior changes in 0.12.0

- **First sync onto existing agent config now hard-stops.** A first sync against a
  repo that already has hand-written instruction files (`CLAUDE.md`, `AGENTS.md`,
  `.cursorrules`, `.github/copilot-instructions.md`) refuses to run unless you pass
  `sync --adopt-existing`. Without the flag, sync points you at
  `agentboot import` (recommended — it decomposes the bespoke content into hub
  artifacts). With the flag, pre-existing files that sync overwrites — including
  root-level artifacts — are archived to `.claude/.agentboot-archive/` before
  anything is written. **Action:** scripted first-time onboarding of repos with
  existing config must either import first or add `--adopt-existing`.
- **Sync now reads the `dist/<platform>/nodes/<group>[/<team>]/` scope layout**, and
  node output wins over legacy dist directories on conflict. Team-scope personas
  that previously compiled to nothing (or never reached spokes) now do — your first
  rebuild + resync after upgrading can deliver genuinely new content to spokes.
  **Action:** review the first post-upgrade sync PRs with that in mind.
- **`dist/plugin` layout changed.** The plugin manifest moved from
  `dist/plugin/plugin.json` to `dist/plugin/.claude-plugin/plugin.json` (required by
  the plugin spec), the plugin name became kebab-case (`<org>-personas`), and
  compliance hooks are now actually registered via a generated `hooks/hooks.json`.
  **Action:** any tooling reading `dist/plugin/plugin.json` must read the new path;
  installed plugins now enforce hooks that were previously dead files.
- **The MCP server is read-only by default.** `agentboot mcp-server` hides and
  rejects the mutating tools (`build`, `sync`, `propose_change`) unless started with
  `--profile maintainer` or `AGENTBOOT_MCP_PROFILE=maintainer`. **Action:** MCP
  clients that relied on mutating tools must opt in to the maintainer profile.
- **The build-time secret scan got stricter.** `validate --strict` now catches bare
  AWS access-key IDs, JWTs, and DSA private-key headers that previously only the
  runtime input-scan hook blocked. **Action:** hub content (including test fixtures)
  that previously passed validation may now fail; scrub or use placeholder values.
- **Generated `npx agentboot` invocations are version-pinned.** MCP server entries
  emitted into `.mcp.json`, `mcp.json`, and Codex `config.toml` pin the compiling
  AgentBoot version instead of resolving `latest` at session start. **Action:**
  spokes no longer pick up new versions until you rebuild and resync — deliberate,
  but a change if you relied on floating `latest`.

### Behavior changes in 0.13.0

- **Import never overwrites an existing artifact.** Previously, two repos importing
  the same trait/rule/persona slug in one sweep both planned `create`, and the
  second write silently clobbered the first. Now: duplicate content becomes a
  provenance-only update on the existing artifact; distinct content under the same
  slug is appended and counted as an update; in a multi-repo `import --parent`
  sweep, later copies of shared content are labeled `merge` and converge on one
  promoted org artifact. **Action:** import plans and results look different — if
  you post-process import output, expect `merge` actions, `Updated:` counts, and
  `cross_repo_promotions` in the staging file.
- **Imported artifacts carry multi-source provenance frontmatter**
  (`source:` + `additional_sources:`) on whole-file imports and hub-duplicate skips,
  not just section merges. **Action:** tooling parsing imported-artifact frontmatter
  should tolerate the additional keys.

### Behavior changes in 0.14.0

- **`.agentboot-manifest.json` gained provenance and integrity fields**: the hub
  commit (with a dirty-tree flag), AgentBoot version, sha256 hashes of the config
  and policy-exception files, a sha256 digest over the manifest, and an optional
  SSH signature. **Action:** custom tooling that parses spoke manifests must
  tolerate the new fields; use `agentboot verify-manifest` rather than hand-rolled
  checks.
- **The manifest now inventories all managed files**, including files skipped as
  already-identical on re-sync. Previously a re-sync over an up-to-date repo
  produced a near-empty manifest and silently removed files from drift coverage.
  **Action:** none required — but expect drift-check coverage to widen after the
  first post-upgrade sync, which can surface pre-existing drift it was blind to.
- **Sync PR bodies changed format.** The "Automated AgentBoot sync" boilerplate was
  replaced by a provenance block and a risk-classified change summary. **Action:**
  automation that keys on the old PR body text must be updated.
- **A configured-but-failing signer is a sync error.** If `sync.signing` is set and
  signing fails, sync fails — it never silently falls back to unsigned. **Action:**
  ensure the signing key is available wherever sync runs (including CI).

### Behavior changes in 0.15.0

- **`agentboot conformance` and per-platform enforcement manifests.** Builds now
  produce `dist/<platform>/enforcement-manifest.json` recording the declared
  enforcement level and per-probe expected-vs-observed results; advisory platforms
  get a manifest stating plainly that no enforcement mechanism exists. **Action:**
  a new artifact appears in `dist/`; if you add `agentboot conformance` to CI
  (recommended), it exits non-zero when observed hook behavior diverges from the
  declared level — that is the point, but budget for triage when you first enable it.
- **Enforcement classification has a single source of truth** shared by `doctor`,
  the conformance harness, and the capability-matrix docs. **Action:** `doctor`
  output wording for platform enforcement may differ from earlier releases.

---

## v0.10 → v0.11

> **v0.11 is a public Beta.** It's usable end to end, but breaking changes may still
> occur before **v1.0 GA**. See the [Roadmap](roadmap.md) for what's ahead.

**What changed:** v0.11 adds a third official platform — **OpenAI Codex** — and makes
governance a first-class output. Compliance hooks are now emitted for **Claude Code,
Codex, and GitHub Copilot** from one canonical set of portable scripts, blocking on
exit code 2 (verified on Claude Code and Codex; Copilot's exit-2 behaviour is
documented but not yet verified, and its command-hooks fail open on timeout — see the
[platform capability matrix](platform-capability-matrix.md)), alongside drift
detection, HARD/SOFT guardrails, and
managed-settings output. It also introduces user-level installs (`install-user`),
packaged harness templates (`add template`, starting with `sdlc-orchestrator`), and
weight-tiered trait sections. None of your existing hub source needs to be rewritten —
but you must **re-run install, rebuild, and re-sync** to write the new hook and managed-
settings files into your hub and every spoke.

### Migration steps

**1. Update the package**

```bash
npm install -g agentboot@latest
```

Verify:

```bash
agentboot --version   # should show 0.11.x or higher
```

**2. Re-run install in your hub**

```bash
cd /path/to/your-personas-hub
agentboot install
```

Safe to run on an existing hub. It writes the new canonical hook scripts and the
managed-settings scaffolding, and leaves your traits, personas, gotchas, `repos.json`,
and `agentboot.config.json` untouched.

**3. (Optional) Enable Codex output**

If your team uses the OpenAI Codex CLI, add it to your build targets in
`agentboot.config.json`:

```jsonc
{
  "personas": {
    "outputFormats": ["claude", "codex", "copilot"]
  }
}
```

See [`docs/configuration.md`](configuration.md) for the full `personas.outputFormats` list.
Existing platforms keep building unchanged if you skip this.

**4. Build and sync**

Rebuild and push to every registered repo. This is the step that actually distributes
the new cross-platform hooks and managed settings to your spokes:

```bash
cd /path/to/your-personas-hub
agentboot build
agentboot sync
```

Sync opens a pull request per repo (drift-checked). Review and merge as usual — the new
managed-settings and hook files land under each spoke's `.claude/`, `.codex/`, and
`.github/` as applicable.

**5. Restart Claude Code**

Blocking hooks and managed settings are read at session start. Restart Claude Code in
any repo (hub or spoke) to pick them up:

```bash
claude
```

**6. Verify**

```bash
agentboot doctor
```

`doctor` now reports real content-hash drift and flags any managed file a repo's
`.gitignore` would silently exclude from sync — a synced repo with locally modified
managed files is correctly surfaced. `/ab status` likewise reports the full artifact
inventory (personas, traits, gotchas, lexicons — core vs org-specific).

---

### New in v0.11 you can adopt when ready

These are opt-in — upgrading does not require them:

- **User-level install** — `agentboot install-user` writes compiled skills/rules to your
  user scope (`~/.claude`) for a personal setup without a formal org hub. If another tool
  manages `~/.claude` (a `~/.claude/.managed` sentinel or `userLevel.mode: "manifest"`),
  AgentBoot stages its output plus a handoff manifest instead of writing directly.
- **Harness templates** — `agentboot add template <name>` installs a pre-packaged bundle
  into your hub. The first is **`sdlc-orchestrator`**, a phase-gated delivery persona
  (spec/PRD → architecture → parallel-worktree implementation → QA gates → review) whose
  rigor is tunable via trait weights.
- **Weight-tiered trait sections** — a trait may split weight-sensitive guidance into
  `### LOW|MEDIUM|HIGH|MAX` sections; the compiler injects only the tier nearest the
  persona's weight, cutting token bloat. Untiered traits compile exactly as before, so
  this is fully backward-compatible.

---

### Surface changes to be aware of

- **Pruned from top-level help (still functional).** The marketplace subsystem
  (`publish`, `marketplace`, `registry`) and the `test --judge` / `--verbose` /
  `--min-score` evaluation flags are hidden from `--help` in the v1.0 surface. They still
  run if you invoke them directly — no scripts break — but they are no longer advertised.
- **Removed MCP tool.** The non-functional `agentboot_optimize_metrics` MCP tool was
  dropped. The real capability is the telemetry-driven `agentboot optimize` CLI; point any
  automation there instead.

---

## v0.9 → v0.10

**What changed:** v0.10 ships the `/ab` skill — a five-agent orchestrator that replaces
direct CLI usage for interactive work. It also introduces the AgentBoot MCP server, which
the skill requires. Neither existed in v0.9, so a fresh `agentboot install` is needed
to write the new files into your hub.

**`/ab` is available in every repo, not just the hub.** After installing and syncing,
developers can use `/ab` from any spoke repo without switching to the hub directory.
The MCP server resolves the hub automatically from a global registry written during
`agentboot install`.

### Migration steps

**1. Update the package**

```bash
npm install -g agentboot@latest
```

Verify:

```bash
agentboot --version   # should show 0.10.x or higher
```

**2. Re-run install in your hub**

```bash
cd /path/to/your-personas-hub
agentboot install
```

This is safe to run on an existing hub. It will:

- Write five skill files into `.claude/agents/`:
  `ab.md`, `ab-author.md`, `ab-diagnose.md`, `ab-manage.md`, `ab-query.md`
- Create or update `.mcp.json` with the AgentBoot MCP server entry. Existing MCP
  server entries are preserved — only the `agentboot` entry is added or updated.
- Register the hub in `~/.agentboot/config.json` so the MCP server can resolve it
  from any repo on this machine.
- Leave all other hub content (traits, personas, gotchas, `repos.json`,
  `agentboot.config.json`) untouched.

**3. Build and sync**

Rebuild your personas and sync to all registered repos. This updates the `/ab` agents
and writes the AgentBoot MCP server entry to every spoke's `.mcp.json`:

```bash
cd /path/to/your-personas-hub
agentboot build
agentboot sync
```

**4. Restart Claude Code**

Claude Code reads `.mcp.json` at startup. Restart it in any repo to pick up the MCP
server — the hub, a spoke, or any other directory:

```bash
claude
```

**5. Verify**

Type `/ab` in Claude Code. The orchestrator should respond and offer to route your
request to the right specialist. If it doesn't, see [Troubleshooting](#troubleshooting)
below.

You can verify from any spoke repo, not just the hub:

```bash
cd /path/to/any-spoke-repo
claude
# then type /ab
```

---

### What you get after upgrading

| Before (v0.9) | After (v0.10) |
|---|---|
| `agentboot build` in terminal | `/ab build` in Claude Code |
| `agentboot sync` in terminal | `/ab sync` in Claude Code |
| `agentboot add trait <name>` | `/ab add trait <name>` |
| `agentboot import --path <dir>` | `/ab import <dir>` |
| `agentboot doctor` | `/ab diagnose` |
| `agentboot cost-estimate` | `/ab cost-estimate` |

The CLI still works for all commands — it is the CI and scripting interface. `/ab`
is the interactive interface for day-to-day use. You do not need to migrate existing
scripts.

---

### If you have multiple hubs

Run `agentboot install` separately in each hub directory. Each hub is registered
in `~/.agentboot/config.json`. The first one registered becomes the default — the
hub the MCP server uses when `/ab` is invoked from a spoke repo.

```bash
cd ~/work/acme-personas && agentboot install
cd ~/work/sideproject-personas && agentboot install
```

To change the default hub, edit `~/.agentboot/config.json` and update the
`"defaultHub"` field to the path you want, or run `agentboot hubs` to view and
manage registered hubs.

---

### If you moved your hub after the v0.9 install

The hub's `.mcp.json` and the global registry (`~/.agentboot/config.json`) both
record the hub's absolute path at install time. If you moved the hub directory,
both will point to the old location and the MCP server will fail to find your config.

Fix: re-run `agentboot install` from the hub's new location. This updates both
`.mcp.json` and the registry entry.

```bash
cd /new/location/personas
agentboot install
```

---

### Troubleshooting

**`/ab` is not recognized in Claude Code**

The skill files were not written or Claude Code has not restarted. Check:

```bash
ls /path/to/your-hub/.claude/agents/
# Should show: ab.md ab-author.md ab-diagnose.md ab-manage.md ab-query.md
```

If the files are missing, re-run `agentboot install` from the hub directory.
If the files are present, restart Claude Code.

**`/ab` responds but MCP tools fail**

The MCP server is not running or is resolving the wrong hub. Check in order:

1. Confirm the global registry points to your hub:
```bash
cat ~/.agentboot/config.json
# "defaultHub" should be your hub's absolute path
```

2. Confirm `.mcp.json` exists in the repo where you're running Claude Code:
```bash
cat /path/to/repo/.mcp.json
# Should contain an "agentboot" entry
```

3. If either is missing or wrong, re-run `agentboot install` from your hub directory.

To confirm the MCP server starts and resolves the right hub, run it manually:

```bash
agentboot mcp-server
```

You should see `AgentBoot MCP server listening` with the hub path shown. `Ctrl+C` to stop.

**MCP server starts but reports wrong hub**

The global registry (`~/.agentboot/config.json`) has a stale `defaultHub` path.
Open it and update `"defaultHub"` to your hub's current absolute path, or re-run
`agentboot install` from the hub to regenerate it automatically.

---

## v0.8 → v0.9

No migration required. Update the package:

```bash
npm install -g agentboot@latest
```

v0.9 added multi-platform output targets (Gemini, Windsurf, JetBrains) and the
`agentboot import` command. These activate automatically if you run `agentboot build`
after upgrading. No config changes needed unless you want to enable the new output
targets — see [`docs/configuration.md`](configuration.md) for the `personas.outputFormats`
field.

---

## General upgrade policy

- **Patch releases (0.x.y):** Always backward-compatible. Update and rebuild.
- **Minor releases (0.x):** Usually backward-compatible. Check this page for any action required.
- **Pre-v1.0:** Breaking changes may occur at any minor release. Release notes and this
  page will document all required migration steps.
- **v1.0+:** Semantic versioning applies. Breaking changes only in major releases.

When in doubt after any upgrade: `agentboot install` in your hub, `agentboot validate`,
`agentboot build`. These three commands will surface any incompatibilities.
