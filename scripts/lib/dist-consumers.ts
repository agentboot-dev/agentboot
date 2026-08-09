/**
 * Which CLI commands read `dist/`, and what each one owes the N1 freshness stamp.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * N1 established that a failed build leaves `dist/` byte-identical, so the
 * presence of files is not evidence that they reflect current policy. The gate
 * (`checkDistFreshness`) was then added to consumers ONE AT A TIME, by hand, as
 * each was noticed: sync, then drift-check and audit, then conformance,
 * baseline and evidence-pack — and install-user, export, publish, test,
 * cost-estimate, doctor, status and lint were still reading a stale tree and
 * reporting green. Three separate sessions each found "the last one".
 *
 * That is this branch's own norm, violated: TWO LISTS THAT MUST AGREE WILL
 * DRIFT. The gated set and the consumer set were both maintained by hand with
 * nothing in code comparing them.
 *
 * So: the CONSUMER set is derived mechanically from scripts/cli.ts (a test
 * parses the command blocks and finds every one that touches dist/), and this
 * file records the POSTURE each consumer takes. A command that starts reading
 * dist/ and is not listed here fails the invariant test — it cannot be added
 * silently, and it cannot be added without stating which posture it takes and
 * why.
 *
 * THE THREE POSTURES
 * ------------------
 * `gated`     The command acts on dist/ — it ships it, packages it, installs it,
 *             or makes an evidence claim from it. It calls
 *             `assertDistFreshOrExit` and REFUSES on a stale tree. This is the
 *             default for anything with consequence outside the hub.
 *
 * `reports`   The command's job is to TELL THE OPERATOR what state the hub is
 *             in. Refusing would remove the very answer the operator ran it to
 *             get ("why is my hub unhealthy?"). It calls `reportDistFreshness`,
 *             which prints the same staleness finding and returns it, so the
 *             command can fold it into its own result and exit code. Reporting
 *             is NOT a weaker posture — silence is what is forbidden, not
 *             continuing.
 *
 * `producer`  The command WRITES dist/ (or removes it). Gating a producer on
 *             the freshness of its own output is circular. Each carries a
 *             reason, because "it's a producer" is exactly the claim that must
 *             not be assertable by hand-wave.
 */

export type DistConsumerPosture = "gated" | "reports" | "producer";

export interface DistConsumer {
  posture: DistConsumerPosture;
  /** Why this posture and not `gated`. Required for `reports` and `producer`. */
  reason?: string;
  /**
   * File the gate call lives in, when it is not `scripts/cli.ts` — `sync`
   * asserts inside `syncRepos()` so the refusal is shared with the MCP surface.
   */
  gateIn?: string;
}

export const DIST_CONSUMERS: Record<string, DistConsumer> = {
  // --- producers -----------------------------------------------------------
  build: {
    posture: "producer",
    reason: "writes dist/ and writes the stamp; gating it on its own output is circular",
  },
  "dev-build": {
    posture: "producer",
    reason: "the maintainer-facing build of this repo's own dist/ — same as build",
  },
  uninstall: {
    posture: "producer",
    reason: "removes dist/; the freshness of a tree being deleted is not a question",
  },

  // --- gated: act on dist/, refuse when it cannot be trusted ---------------
  sync: {
    posture: "gated",
    gateIn: "scripts/sync.ts",
    reason: "ships dist/ to spokes — the original N1 case",
  },
  "drift-check": { posture: "gated" },
  audit: { posture: "gated" },
  conformance: { posture: "gated" },
  baseline: { posture: "gated" },
  "evidence-pack": { posture: "gated" },
  "install-user": {
    posture: "gated",
    reason:
      "A2-residual: a SECOND delivery channel. It writes org policy onto a developer's " +
      "machine and gated on fs.existsSync(distCore) — existence read as freshness, the " +
      "exact pattern the sync gate was written to kill.",
  },
  export: {
    posture: "gated",
    reason:
      "A3-residual: packages dist/ into a distributable (plugin zip, agentskills bundle). " +
      "Higher consequence than audit, which was already gated.",
  },
  publish: {
    posture: "gated",
    reason: "publishes dist/plugin to a marketplace — export's consequence, made public",
  },
  test: {
    posture: "gated",
    reason:
      "snapshots and behavioral runs are claims ABOUT the compiled tree; a green run " +
      "against a superseded tree is a false pass banked as a baseline",
  },
  "cost-estimate": {
    posture: "gated",
    reason: "states what the deployed prompt costs; from a stale tree that is a wrong number stated as fact",
  },
  "dev-sync": {
    posture: "gated",
    gateIn: "scripts/dev-sync.ts",
    reason:
      "R2-1: copies dist/ into the repo's live agent-tool locations — install-user's " +
      "consequence, aimed at the maintainers. It gated on fs.existsSync(dist/) alone. " +
      "Being dev-only is not a reason: it decides which personas AgentBoot is developed " +
      "against, so a stale copy means the tool is dogfooding policy it has replaced.",
  },

  // --- reports: the answer IS the state, so say it, do not refuse ----------
  doctor: {
    posture: "reports",
    reason:
      "V5: doctor is the one command an operator runs to ask whether the hub is healthy. " +
      "Exiting before its checks run would withhold the diagnosis. It reports the stale " +
      "tree as a FAILED check instead — which still fails the command.",
  },
  status: {
    posture: "reports",
    reason:
      "A4-residual: status exists to describe the hub. It must read the STAMP rather than " +
      "dist/'s directory mtime — the mtime is the timestamp of the last SUCCESSFUL build " +
      "and is printed unchanged after a failed one.",
  },
  "mcp-server": {
    posture: "reports",
    gateIn: "scripts/mcp-server.ts",
    reason:
      "R2-1: the whole MCP surface was outside this invariant, because the derivation " +
      "parses scripts/cli.ts and the `mcp-server` command block only spawns " +
      "mcp-server.ts as a subprocess — the dist/ reads are in another file. It serves " +
      "compiled persona and skill CONTENT to an agent tagged `source: \"dist\"`, and " +
      "reported lastBuiltAt from dist/'s directory mtime, which is the timestamp of " +
      "the last SUCCESSFUL build and survives a failed one unchanged. `reports` and " +
      "not `gated` for the same reason as doctor/status: these tools exist to describe " +
      "hub state, and a server that refuses to answer withholds the diagnosis. Every " +
      "answer now carries the staleness with it.",
  },
  lint: {
    posture: "reports",
    reason:
      "lint's dist/ read is one advisory token count over compiled CLAUDE.md; refusing to " +
      "lint the SOURCES because the compiled tree is stale would be an outage. It says the " +
      "count came from a stale tree.",
  },
};
