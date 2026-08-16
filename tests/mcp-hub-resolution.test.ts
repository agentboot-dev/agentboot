/**
 * L37 / H.1 — THE HUB-RESOLUTION FALLBACK WAS INVISIBLE ON THE CHANNEL THE USER READS.
 *
 * When `mcp-server` resolves no hub from `AGENTBOOT_HUB`, the current directory
 * or the global registry, it falls back to AgentBoot's OWN package directory and
 * serves the bundled personas, traits and gotchas — as though they were the
 * organization's. The server starts, the handshake succeeds, every tool answers,
 * and every answer is about the wrong corpus.
 *
 * That was announced by one `console.error`. On an MCP **stdio** server stderr is
 * captured by the CLIENT, into a log file the user has to know exists and go
 * looking for; the user's channel is the tool result. So a misconfigured spoke
 * got a confident, well-formed, entirely wrong description of its own governance
 * with nothing on the surface it reads to say so — the product's own recurring
 * defect class, a green surface over a failure.
 *
 * THE FIX IS A VALUE, NOT A LOUDER DIAGNOSTIC. `agentboot_status` now returns
 * `hubResolution` — which rung of the ladder won, the path it produced, and
 * whether it is the no-hub fallback.
 *
 * The positive case is asserted as hard as the negative one: a test that only
 * checks the fallback would pass just as well against a field hardcoded to
 * `fallback: true`, which would train every reader to ignore it.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

interface HubResolution {
  source: string;
  path: string;
  fallback: boolean;
  note?: string;
}

/**
 * Drive one MCP tool call over stdio and return the parsed tool payload,
 * alongside whatever went to stderr (the channel the diagnostic uses).
 */
function mcp(
  tool: string,
  opts: { cwd: string; env?: Record<string, string | undefined> },
): { payload: Record<string, unknown>; stderr: string } {
  const req =
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    }) +
    "\n" +
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: tool, arguments: {} },
    }) +
    "\n";
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, NODE_NO_WARNINGS: "1", ...(opts.env ?? {}) })) {
    if (v !== undefined) env[k] = v;
  }
  const r = spawnSync(process.execPath, [CLI, "mcp-server"], {
    cwd: opts.cwd,
    input: req,
    env,
    encoding: "utf-8",
    timeout: 300_000,
  });
  const lines = (r.stdout ?? "").trim().split("\n").filter(Boolean);
  for (const line of lines.reverse()) {
    try {
      const msg = JSON.parse(line) as { id?: number; result?: { content?: Array<{ text?: string }> } };
      if (msg.id === 2 && msg.result?.content?.[0]?.text) {
        return {
          payload: JSON.parse(msg.result.content[0].text!) as Record<string, unknown>,
          stderr: r.stderr ?? "",
        };
      }
    } catch {
      /* not the frame we want */
    }
  }
  throw new Error(`no MCP result for ${tool}: ${r.stdout}${r.stderr}`);
}

let base: string;
let hub: string;
/** A directory that is NOT a hub, with an isolated (empty) registry home. */
let elsewhere: string;
let emptyHome: string;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-hubres-"));
  hub = path.join(base, "hub");
  elsewhere = path.join(base, "not-a-hub");
  emptyHome = path.join(base, "empty-home");
  fs.mkdirSync(elsewhere, { recursive: true });
  fs.mkdirSync(emptyHome, { recursive: true });

  const inst = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (inst.status !== 0) throw new Error(`hub scaffold failed: ${inst.stdout}${inst.stderr}`);
  // Guard the guard: if this is not really a hub, the "resolves to the hub"
  // assertions below would be measuring nothing.
  if (!fs.existsSync(path.join(hub, "agentboot.config.json"))) {
    throw new Error("scaffold produced no agentboot.config.json");
  }
}, 300_000);

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

describe("L37 — agentboot_status reports how the hub was resolved", () => {
  it("POSITIVE: AGENTBOOT_HUB wins, and is NOT reported as a fallback", () => {
    const { payload } = mcp("agentboot_status", { cwd: elsewhere, env: { AGENTBOOT_HUB: hub } });
    const res = payload["hubResolution"] as HubResolution | undefined;
    expect(res, "agentboot_status must return hubResolution").toBeDefined();
    expect(res!.source).toBe("env");
    expect(res!.fallback).toBe(false);
    expect(path.resolve(res!.path)).toBe(path.resolve(hub));
    // The hub really was served — not the package's own content.
    expect((payload["hub"] as { org?: string }).org).toBe("acme");
  }, 300_000);

  it("POSITIVE: cwd-is-a-hub is reported as `cwd`", () => {
    const { payload } = mcp("agentboot_status", {
      cwd: hub,
      env: { AGENTBOOT_HUB: undefined, AGENTBOOT_HOME: emptyHome },
    });
    const res = payload["hubResolution"] as HubResolution;
    expect(res.source).toBe("cwd");
    expect(res.fallback).toBe(false);
    // realpath both sides: on macOS /var is a symlink to /private/var, and
    // `process.cwd()` reports the resolved form while mkdtemp reports the link.
    expect(fs.realpathSync(res.path)).toBe(fs.realpathSync(hub));
  }, 300_000);

  it("NEGATIVE: with no hub anywhere, the fallback is visible IN THE TOOL RESULT", () => {
    // No AGENTBOOT_HUB, cwd is not a hub, and the registry home is empty — the
    // exact state a misconfigured spoke is in.
    const { payload, stderr } = mcp("agentboot_status", {
      cwd: elsewhere,
      env: { AGENTBOOT_HUB: undefined, AGENTBOOT_HOME: emptyHome },
    });
    const res = payload["hubResolution"] as HubResolution | undefined;
    expect(res, "agentboot_status must return hubResolution").toBeDefined();
    expect(res!.source).toBe("package-fallback");
    expect(res!.fallback).toBe(true);
    expect(path.resolve(res!.path)).toBe(path.resolve(ROOT));
    // The note must say what is actually wrong — that these answers are about
    // AgentBoot's own content — not merely that a fallback occurred.
    expect(res!.note ?? "").toMatch(/bundled content/i);

    // The stderr diagnostic still fires (it is right for the client log). It is
    // no longer the ONLY place the condition appears, which was the defect.
    expect(stderr).toMatch(/No hub resolved/);
  }, 300_000);

  it("the two channels agree — stderr fires exactly when fallback is true", () => {
    // A field that says `fallback: false` while stderr says otherwise would be a
    // worse defect than the one being fixed.
    const good = mcp("agentboot_status", { cwd: elsewhere, env: { AGENTBOOT_HUB: hub } });
    expect((good.payload["hubResolution"] as HubResolution).fallback).toBe(false);
    expect(good.stderr).not.toMatch(/No hub resolved/);
  }, 300_000);
});

describe("L37 — cli-reference.md documents the ladder the server ships", () => {
  const doc = fs.readFileSync(path.join(ROOT, "docs", "cli-reference.md"), "utf-8");

  it("has an mcp-server-specific resolution section", () => {
    // The reference used to publish ONE ladder headed "uniform across commands",
    // whose step 1 was a `--config` flag the server does not accept and whose
    // step 4 promised read-only commands never silently act on the registry —
    // which is precisely what the server does.
    expect(doc).toMatch(/###\s+Hub resolution order \(`agentboot mcp-server`\)/);
    expect(doc).not.toMatch(/###\s+Hub resolution order \(uniform across commands\)/);
  });

  it("names every source value the server can return", () => {
    for (const source of ["env", "cwd", "registry", "package-fallback"]) {
      expect(doc, `cli-reference.md should document hubResolution source \`${source}\``)
        .toContain(`\`${source}\``);
    }
    expect(doc).toContain("hubResolution");
  });

  it("does not claim the server accepts --config", () => {
    // Scoped to the server's own ladder section — `--config` is real everywhere else.
    const section = doc.split(/###\s+Hub resolution order \(`agentboot mcp-server`\)/)[1]!;
    const untilNextHeading = section.split(/\n###?\s/)[0]!;
    expect(untilNextHeading).not.toMatch(/^\s*1\.\s+\*\*`--config/m);
  });
});
